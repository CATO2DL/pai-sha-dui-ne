#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaultEngine = require('../dist/engine.js');

const POLICY_VERSION = 'visible3-two-ply-v1';
const DEFAULT_PREFIX = 'aq-difficulty-v3-20261105';
const UNKNOWN = '__hidden_tail__';
const defaults = Object.freeze({ prefix: DEFAULT_PREFIX, start: 0, count: 300, threshold: 130, maxSteps: 500, stallLimit: 60, lookahead: true, tiePrefix: 'independent-policy-ties-v1', trace: false });

function randomFor(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return () => {
    hash += 0x6D2B79F5;
    let n = hash;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

const isKnown = group => group && !group.species.startsWith(UNKNOWN);
const copyGroup = group => ({ species: group.species, count: group.count });
const sourceKey = source => source.type === 'buffer' ? 'b' : `q${source.index}`;
const moveKey = move => `${sourceKey(move.from)}>${sourceKey(move.to)}`;

// This is the ONLY observation passed to policy ranking and hypothetical moves.
// A sentinel says a queue continues, but reveals no species, counts, or depth.
// Two-ply planning cannot consume all three known head groups and touch it.
function observe(state) {
  return {
    level: state.level, seed: state.seed, total: state.total, cleared: state.cleared,
    moves: state.moves, status: state.status,
    queues: state.queues.map((queue, index) => {
      const visible = queue.slice(0, 3).map(copyGroup);
      if (queue.length > 3) visible.push({ species: `${UNKNOWN}${index}`, count: 1 });
      return visible;
    }),
    buffer: state.buffer.map(copyGroup)
  };
}

function signature(state) {
  return JSON.stringify([state.cleared, state.queues.map(queue => queue.slice(0, 3).map(group => [group.species, group.count])), state.buffer.map(group => [group.species, group.count])]);
}

function visiblePotential(state) {
  const heads = state.queues.map(queue => queue[0]).filter(isKnown);
  let score = 0;
  for (let a = 0; a < heads.length; a++) for (let b = a + 1; b < heads.length; b++) {
    if (heads[a].species === heads[b].species) score += heads[a].count + heads[b].count >= 5 ? 35 : 4;
  }
  if (state.buffer[0]) {
    const first = state.buffer[0];
    for (const head of heads) if (head.species === first.species) score += head.count + first.count >= 5 ? 45 : 18;
  }
  const buffered = new Map();
  for (const group of state.buffer) buffered.set(group.species, (buffered.get(group.species) || 0) + group.count);
  for (const head of heads) {
    const count = buffered.get(head.species) || 0;
    if (count) score += count + head.count >= 5 ? 38 : 5;
  }
  // Estimate access to matches using only the already observed next two groups.
  for (const [type, count] of buffered) {
    let nearest = Infinity;
    for (const queue of state.queues) for (let depth = 0; depth < Math.min(3, queue.length); depth++) {
      if (isKnown(queue[depth]) && queue[depth].species === type) nearest = Math.min(nearest, depth);
    }
    if (nearest === Infinity) score -= count * 6;
    else score += (3 - nearest) * Math.min(4, count);
  }
  return score;
}

function localScore(before, move, result) {
  const next = result.state;
  if (next.status === 'won') return 10000000;
  if (next.status === 'lost') return -10000000 + result.cleared * 10000;
  const releasedSlots = before.buffer.length - next.buffer.length;
  const active = next.queues.filter(queue => queue.length).length;
  const closed = before.queues.filter(queue => queue.length).length - active;
  let score = result.cleared * 10000;
  score += releasedSlots * 55 + active * 12 - closed * 20;
  score += visiblePotential(next) - visiblePotential(before);
  score -= next.buffer.length * next.buffer.length * 7;
  if (move.from.type === 'buffer') score += 8;
  if (move.to.type === 'buffer' && !result.cleared) score -= 12;
  return score;
}

function chooseMove(observation, engine, seen, random, options) {
  const candidates = [];
  for (const move of engine.legalMoves(observation)) {
    if (!isKnown(engine.getHead(observation, move.from))) continue;
    const result = engine.applyMove(observation, move.from, move.to);
    if (!result.ok) throw new Error('Engine listed an illegal move');
    const key = signature(result.state);
    if (seen.has(key)) continue;
    let score = localScore(observation, move, result);
    if (options.lookahead && result.state.status === 'playing') {
      let future = -10000000;
      for (const nextMove of engine.legalMoves(result.state)) {
        if (!isKnown(engine.getHead(result.state, nextMove.from))) continue;
        const nextResult = engine.applyMove(result.state, nextMove.from, nextMove.to);
        if (!nextResult.ok) throw new Error('Engine listed an illegal lookahead move');
        const nextKey = signature(nextResult.state);
        if (seen.has(nextKey) || nextKey === signature(observation)) continue;
        future = Math.max(future, localScore(result.state, nextMove, nextResult));
      }
      // Immediate clears dominate. Future clears break ties between sensible options.
      score += Math.max(-1000, Math.min(200000, future)) * .1;
    }
    candidates.push({ move, score, tie: random() });
  }
  candidates.sort((a, b) => b.score - a.score || b.tie - a.tie || moveKey(a.move).localeCompare(moveKey(b.move)));
  return candidates[0]?.move || null;
}

function runGame(seed, supplied = {}) {
  const options = { ...defaults, ...supplied };
  const engine = options.engine || defaultEngine;
  let state = options.createState ? options.createState(seed, engine) : engine.createLevel(2, seed);
  const random = randomFor(`${options.tiePrefix}|${seed}`);
  const seen = new Set();
  const history = [];
  let lastClearMove = 0, reason = null;
  while (state.status === 'playing' && state.moves < options.maxSteps) {
    if (state.moves - lastClearMove >= options.stallLimit) { reason = 'clear_stall_limit'; break; }
    const observation = observe(state);
    seen.add(signature(observation));
    const move = chooseMove(observation, engine, seen, random, options);
    if (!move) { reason = 'all_visible_successors_seen'; break; }
    const result = engine.applyMove(state, move.from, move.to);
    if (!result.ok) throw new Error(`Visible policy chose an illegal action for seed ${seed}: ${JSON.stringify(move)}`);
    state = result.state;
    if (result.cleared) lastClearMove = state.moves;
    if (options.trace) history.push({ ...move, cleared: result.cleared, rulesVersion: engine.RULES_VERSION });
  }
  const outcome = state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : reason ? 'no_progress' : 'cap';
  const result = {
    seed: String(seed), tieSeed: `${options.tiePrefix}|${seed}`, outcome,
    stopReason: reason || (outcome === 'cap' ? 'max_steps' : 'engine_terminal'),
    cleared: state.cleared, total: state.total, clearedFraction: state.cleared / state.total,
    moves: state.moves, reachedThreshold: state.cleared >= options.threshold,
    activeQueues: state.queues.filter(queue => queue.length).length,
    bufferGroups: state.buffer.length, bufferAnimals: state.buffer.reduce((sum, group) => sum + group.count, 0),
    movesSinceLastClear: state.moves - lastClearMove
  };
  if (options.trace) result.history = history;
  return result;
}

function rateWithInterval(successes, count) {
  if (!count) return { successes, count, rate: null, wilson95: [null, null] };
  const rate = successes / count, z = 1.95996398454, denominator = 1 + z * z / count;
  const center = (rate + z * z / (2 * count)) / denominator;
  const margin = z * Math.sqrt(rate * (1 - rate) / count + z * z / (4 * count * count)) / denominator;
  return { successes, count, rate, wilson95: [center - margin, center + margin] };
}

function blocks(results, size, threshold) {
  const list = [];
  for (let from = 0; from < results.length; from += size) {
    const group = results.slice(from, from + size);
    list.push({ block: list.length + 1, fromIndex: from, count: group.length, complete: group.length === size,
      firstSeed: group[0].seed, lastSeed: group.at(-1).seed,
      reachedThreshold: group.filter(game => game.cleared >= threshold).length,
      reached80Animals: group.filter(game => game.cleared >= 80).length,
      reached130Animals: group.filter(game => game.cleared >= 130).length,
      wins: group.filter(game => game.outcome === 'won').length });
  }
  return list;
}

function histogram(values) { return values.reduce((out, value) => { out[value] = (out[value] || 0) + 1; return out; }, {}); }

function summarize(results, options) {
  const sorted = results.map(game => game.cleared).sort((a, b) => a - b);
  const count = results.length;
  const block10 = blocks(results, 10, options.threshold), block30 = blocks(results, 30, options.threshold);
  return {
    count,
    threshold: rateWithInterval(results.filter(game => game.cleared >= options.threshold).length, count),
    atLeast80Animals: rateWithInterval(results.filter(game => game.cleared >= 80).length, count),
    atLeast130Animals: rateWithInterval(results.filter(game => game.cleared >= 130).length, count),
    wins: rateWithInterval(results.filter(game => game.outcome === 'won').length, count),
    outcomes: histogram(results.map(game => game.outcome)),
    meanCleared: results.reduce((sum, game) => sum + game.cleared, 0) / count,
    medianCleared: (sorted[Math.floor((count - 1) / 2)] + sorted[Math.floor(count / 2)]) / 2,
    meanMoves: results.reduce((sum, game) => sum + game.moves, 0) / count,
    blocks10: { requiredAtLeast: 8, passed: block10.filter(block => block.complete && block.reachedThreshold >= 8).length, complete: block10.filter(block => block.complete).length, distribution: histogram(block10.filter(block => block.complete).map(block => block.reachedThreshold)), blocks: block10 },
    blocks30: { requiredWinsAtMost: 1, passed: block30.filter(block => block.complete && block.wins <= 1).length, complete: block30.filter(block => block.complete).length, distribution: histogram(block30.filter(block => block.complete).map(block => block.wins)), blocks: block30 }
  };
}

function runBatch(supplied = {}) {
  const options = { ...defaults, ...supplied };
  const engine = options.engine || defaultEngine;
  const started = performance.now();
  const results = [];
  for (let index = options.start; index < options.start + options.count; index++) {
    const seed = options.prefix ? `${options.prefix}:${index}` : String(index);
    results.push({ index, ...runGame(seed, options) });
    if (options.onProgress) options.onProgress(results.length, options.count, results.at(-1));
  }
  return {
    method: { policyVersion: POLICY_VERSION, rulesVersion: engine.RULES_VERSION,
      observation: 'Only current first three groups of each main queue and the complete buffer; hidden tails are anonymous sentinels in planning.',
      strategy: 'Immediate clears, one extra visible-information ply, buffer space, visible matches, active queues, seeded tie breaks, and no repeated visible states.',
      caveat: 'Synthetic policy results, not human win rates. Lost means no legal operation at the reached state; no_progress and cap do not prove the original board unsolvable.',
      prefix: options.prefix, start: options.start, count: options.count, thresholdAnimals: options.threshold,
      maxSteps: options.maxSteps, stallLimit: options.stallLimit, lookahead: options.lookahead, tiePrefix: options.tiePrefix },
    elapsedSeconds: (performance.now() - started) / 1000,
    summary: summarize(results, options), results
  };
}

function parseArguments(argv) {
  const options = {};
  const names = { '--prefix': 'prefix', '--start': 'start', '--count': 'count', '--threshold': 'threshold', '--generator-version': 'generatorVersion', '--max-steps': 'maxSteps', '--stall-limit': 'stallLimit', '--tie-prefix': 'tiePrefix', '--output': 'output' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--trace') { options.trace = true; continue; }
    if (arg === '--no-lookahead') { options.lookahead = false; continue; }
    if (arg === '--help') { options.help = true; continue; }
    if (!names[arg] || argv[index + 1] === undefined) throw new Error(`Unknown or incomplete option: ${arg}`);
    const key = names[arg], value = argv[++index];
    options[key] = ['start', 'count', 'threshold', 'generatorVersion', 'maxSteps', 'stallLimit'].includes(key) ? Number(value) : value;
  }
  for (const key of ['start', 'count', 'threshold', 'maxSteps', 'stallLimit']) {
    if (options[key] !== undefined && (!Number.isInteger(options[key]) || options[key] < (key === 'start' ? 0 : 1))) throw new Error(`Invalid ${key}`);
  }
  return options;
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write('node scripts/simulate.cjs [--generator-version N] [--prefix TEXT] [--start 0] [--count 300] [--threshold N (default: 80% rounded to five)] [--max-steps 500] [--stall-limit 60] [--tie-prefix TEXT] [--no-lookahead] [--trace] [--output report.json]\n');
    } else {
      const generatorVersion = options.generatorVersion ?? defaultEngine.GENERATOR_VERSION;
      const createState = seed => defaultEngine.createLevel(2, seed, generatorVersion);
      const threshold = options.threshold ?? Math.ceil(createState('simulation-threshold').total * .8 / 5) * 5;
      const report = runBatch({ ...options, createState, threshold, onProgress: (done, total) => { if (done % 30 === 0) process.stderr.write(`Simulated ${done}/${total}\n`); } });
      report.method.generatorVersion = generatorVersion;
      report.engineSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../dist/engine.js'))).digest('hex');
      report.simulatorSha256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
      const json = JSON.stringify(report, null, 2) + '\n';
      if (options.output) {
        fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
        fs.writeFileSync(options.output, json);
        const compact = { output: path.resolve(options.output), method: report.method, elapsedSeconds: report.elapsedSeconds, summary: { ...report.summary, blocks10: { ...report.summary.blocks10, blocks: undefined }, blocks30: { ...report.summary.blocks30, blocks: undefined } } };
        process.stdout.write(JSON.stringify(compact, null, 2) + '\n');
      } else process.stdout.write(json);
    }
  } catch (error) { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }
}

module.exports = { runGame, runBatch, summarize, observe, chooseMove, defaults, POLICY_VERSION };
