#!/usr/bin/env node
'use strict';
// Observe only the first four individual animals in each lane and the buffer.
// Plan one five-clear using those visible prefixes; never use a construction
// certificate, a seed's future layout, or deeper hidden animals to choose moves.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const E = require('../dist/engine.js');
const DEPTH = 4;
const POLICY = 'visible-four-animals-one-clear-v2';
const sum = groups => groups.reduce((n, g) => n + g.count, 0);
const b = { type: 'buffer' };
const q = index => ({ type: 'queue', index });
function randomFor(seed) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => { value += 0x6D2B79F5; let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function choose(state, random, previousMove) {
  const visible = state.queues.map(queue => {
    const animals = [];
    for (const group of queue) {
      for (let n = 0; n < group.count && animals.length < DEPTH; n++) animals.push(group.species);
      if (animals.length >= DEPTH) break;
    }
    return animals;
  });
  const stored = new Map();
  state.buffer.forEach(g => stored.set(g.species, (stored.get(g.species) || 0) + g.count));
  const budget = 8 - sum(state.buffer);
  const candidates = [];
  for (const type of new Set(visible.flat())) {
    const needed = 5 - (stored.get(type) || 0);
    let dp = new Map([[0, { cost: 0, actions: [] }]]);
    visible.forEach((lane, index) => {
      const options = [{ count: 0, cost: 0 }];
      let count = 0;
      lane.forEach((animal, offset) => {
        if (animal === type && ++count <= needed) options.push({ count, cost: offset + 1 });
      });
      const next = new Map();
      for (const [have, plan] of dp) for (const option of options) {
        const total = have + option.count, cost = plan.cost + option.cost;
        if (total > needed || cost > budget) continue;
        if (!next.has(total) || cost < next.get(total).cost) {
          next.set(total, { cost, actions: [...plan.actions, ...Array(option.cost).fill(index)] });
        }
      }
      dp = next;
    });
    const plan = dp.get(needed);
    if (plan?.actions.length) candidates.push({ ...plan, stored: stored.get(type) || 0, tie: random() });
  }
  candidates.sort((a, c) => a.cost - c.cost || c.stored - a.stored || a.tie - c.tie);
  if (candidates.length) return { from: q(candidates[0].actions[0]), to: b, planned: true };
  // A legal immediate return may also complete five or release a buffer slot.
  // Fallback scoring uses only heads/visible prefixes, not a simulated tail.
  const legal = [];
  visible.forEach((lane, index) => {
    if (!lane.length) return;
    if (sum(state.buffer) < 7 || stored.get(lane[0]) === 4) legal.push({ from: q(index), to: b });
    if (state.buffer[0]?.species === lane[0]) legal.push({ from: b, to: q(index) });
  });
  const samePlace = (a, c) => a.type === c.type && (a.type === 'buffer' || a.index === c.index);
  const options = legal.filter(move => !previousMove
    || !samePlace(move.from, previousMove.to) || !samePlace(move.to, previousMove.from)).map(move => {
    const type = move.from.type === 'buffer' ? state.buffer[0].species : visible[move.from.index][0];
    const same = stored.get(type) || 0;
    const score = move.from.type === 'buffer'
      ? (visible[move.to.index].filter((animal, i, lane) => animal === type && lane.slice(0,i).every(t => t === type)).length === 4 ? 100 : 6)
      : (same === 4 ? 100 : same * 4 + visible.flat().filter(t => t === type).length);
    return { ...move, score, tie: random(), planned: false };
  });
  options.sort((a, c) => c.score - a.score || a.tie - c.tie);
  return options[0] || null;
}

function run(seed, level) {
  let state = E.createLevel(level, seed), lastClear = 0, planned = 0, fallback = 0, previousMove = null;
  const random = randomFor('single-policy|' + seed);
  const bins = Array.from({ length: 5 }, () => ({ steps: 0, bufferSum: 0, clearEvents: 0, clearGapSum: 0, maxClearGap: 0 }));
  while (state.status === 'playing' && state.moves < state.total * 3 && state.moves - lastClear < 80) {
    const move = choose(state, random, previousMove);
    if (!move) break;
    const bin = bins[Math.min(4, Math.floor(state.cleared / state.total * 5))];
    const result = E.applyMove(state, move.from, move.to);
    if (!result.ok) throw new Error('Policy proposed an illegal move.');
    if (E.remaining(result.state) + result.state.cleared !== state.total || sum(result.state.buffer) > 7) throw new Error('Invariant failed.');
    state = result.state;
    bin.steps++; bin.bufferSum += sum(state.buffer);
    if (move.planned) planned++; else fallback++;
    if (result.cleared) {
      const gap = state.moves - lastClear;
      bin.clearEvents++; bin.clearGapSum += gap; bin.maxClearGap = Math.max(bin.maxClearGap, gap);
      lastClear = state.moves;
    }
    previousMove = move;
  }
  return { seed, level, outcome: state.status === 'playing' ? 'no_progress' : state.status,
    total: state.total, cleared: state.cleared, moves: state.moves, planned, fallback, bins };
}

function validate(count = 100, prefix = 'single-v4-holdout-20261105') {
  const levels = [];
  for (let level = 1; level <= 5; level++) {
    const results = Array.from({ length: count }, (_, i) => run(`${prefix}:L${level}:${i}`, level));
    const curve = Array.from({ length: 5 }, (_, index) => {
      const aggregate = results.reduce((a, result) => {
        const bin = result.bins[index];
        for (const key of ['steps', 'bufferSum', 'clearEvents', 'clearGapSum']) a[key] += bin[key];
        a.maxClearGap = Math.max(a.maxClearGap, bin.maxClearGap);
        return a;
      }, { steps: 0, bufferSum: 0, clearEvents: 0, clearGapSum: 0, maxClearGap: 0 });
      return { progress: `${index * 20}-${(index + 1) * 20}%`,
        reached: results.filter(r => r.cleared >= r.total * index / 5).length,
        meanBuffer: aggregate.steps ? aggregate.bufferSum / aggregate.steps : null,
        meanMovesBetweenClears: aggregate.clearEvents ? aggregate.clearGapSum / aggregate.clearEvents : null,
        longestClearGap: aggregate.maxClearGap };
    });
    levels.push({ level, lanes: level + 2, total: results[0].total, games: count,
      wins: results.filter(r => r.outcome === 'won').length,
      reached80Percent: results.filter(r => r.cleared >= r.total * .8).length,
      noProgress: results.filter(r => r.outcome === 'no_progress').length,
      curve, results: results.map(({ bins, ...r }) => r) });
  }
  return { method: { policy: POLICY, visibleAnimalsPerLane: DEPTH, prefix, countPerLevel: count,
    note: 'Fixed observation-based strategy, not a human win-rate guarantee. No seed filtering or retuning on this holdout.',
    rulesVersion: E.RULES_VERSION, generatorVersion: E.GENERATOR_VERSION },
    hashes: Object.fromEntries(['dist/generator.js', 'dist/engine.js', 'scripts/validate-single-policy.cjs'].map(file => [file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex')])), levels };
}
if (require.main === module) {
  const output = process.argv[2], count = Number(process.argv[3] || 100), prefix = process.argv[4] || 'single-v4-holdout-20261105';
  if (!output) throw new Error('Usage: node scripts/validate-single-policy.cjs output.json [count-per-level] [seed-prefix]');
  if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing report.');
  const report = validate(count, prefix);
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report.levels.map(({ results, ...level }) => level), null, 2));
}
module.exports = { choose, run, validate, POLICY };
