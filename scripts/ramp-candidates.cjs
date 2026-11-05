'use strict';

const base = require('../dist/engine.js');

function randomFor(seed) {
  let value = 2166136261;
  for (const char of String(seed)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
const length = queue => queue.reduce((n, group) => n + group.count, 0);
function combinations(count, size) {
  const out = [];
  function visit(next, chosen) {
    if (chosen.length === size) { out.push(chosen); return; }
    for (let i = next; i < count; i++) visit(i + 1, [...chosen, i]);
  }
  visit(0, []); return out;
}

function makeTail(selected, config, random, metrics) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    metrics.tailAttempts++;
    const queues = Array.from({ length: config.tailLanes }, () => []);
    const stock = new Map(selected.map((type, i) => [type, i === 0 ? 10 : 5]));
    let pending = 45;
    while (pending) {
      const choices = [];
      for (const type of selected) if (stock.get(type)) {
        for (let lane = 0; lane < queues.length; lane++) if (queues[lane].at(-1)?.species !== type) choices.push({ type, lane });
      }
      if (!choices.length) break;
      const { type, lane } = choices[Math.floor(random() * choices.length)];
      const weights = config.tailWeights.slice(0, Math.min(3, stock.get(type)));
      let value = random() * weights.reduce((a, b) => a + b, 0), count = 1;
      while (count < weights.length && value >= weights[count - 1]) value -= weights[count++ - 1];
      queues[lane].push({ species: type, count }); stock.set(type, stock.get(type) - count); pending -= count;
    }
    if (!pending) return queues;
  }
  throw new Error('Tail adjacency construction exceeded 1000 attempts');
}

function splitAt(progress, config, random) {
  const t = Math.max(0, Math.min(1, (progress - config.easyFraction) / (1 - config.easyFraction)));
  const pair = Math.pow(1 - t, config.rampExponent), quartet = config.quartetMax * t * t;
  const draw = random();
  if (draw < pair) return random() < .8 ? [2, 3] : [1, 4];
  if (draw < pair + quartet) return [2, 1, 1, 1];
  return random() < .5 ? [2, 2, 1] : [3, 1, 1];
}

function createRampCandidate(supplied = {}) {
  const config = { lanes: 6, total: 240, tailLanes: 3, tailWeights: [7, 4, 1], easyFraction: .12, rampExponent: 1.6, quartetMax: .45, overlapPackets: false, ...supplied };
  const stats = { boards: 0, maxAttempts: 0, totalAttempts: 0, tailAttempts: 0, failures: [] };
  function createLevel(level, seed) {
    if (level === 1) return base.createLevel(1, seed);
    const random = randomFor(seed), selected = shuffle(base.species, random).slice(0, 8);
    const metrics = { tailAttempts: 0 };
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const queues = makeTail(selected, config, random, metrics);
      while (queues.length < config.lanes) queues.push([]);
      const stock = new Map(selected.map((type, i) => [type, i === 0 ? 4 : 5]));
      let failed = false;
      let previousLanes = queues.flatMap((q, lane) => q.length ? [lane] : []);
      const packets = [];
      for (let forwardIndex = 38; forwardIndex >= 0; forwardIndex--) {
        const heads = new Set(queues.filter(q => q.length).map(q => q[0].species));
        const eligible = selected.flatMap(type => !heads.has(type) ? Array(stock.get(type)).fill(type) : []);
        if (!eligible.length) { failed = true; break; }
        const type = eligible[Math.floor(random() * eligible.length)];
        const split = shuffle(splitAt(forwardIndex / 38, config, random), random);
        let lanes;
        if (config.overlapPackets) {
          const required = Math.min(split.length, Math.max(1, previousLanes.length - 1));
          const choices = combinations(config.lanes, split.length).filter(lanes => lanes.filter(lane => previousLanes.includes(lane)).length >= required).map(lanes => ({ lanes, length: lanes.reduce((n, lane) => n + length(queues[lane]), 0), tie: random() }));
          choices.sort((a, b) => a.length - b.length || a.tie - b.tie);
          lanes = choices[0].lanes;
        } else lanes = queues.map((q, lane) => ({ lane, length: length(q), tie: random() })).sort((a, b) => a.length - b.length || a.tie - b.tie).slice(0, split.length).map(item => item.lane);
        split.forEach((count, offset) => queues[lanes[offset]].unshift({ species: type, count }));
        previousLanes = lanes;
        stock.set(type, stock.get(type) - 1);
        packets.push({ forwardIndex, species: type, split });
      }
      if (failed) continue;
      stats.boards++; stats.totalAttempts += attempt; stats.maxAttempts = Math.max(stats.maxAttempts, attempt); stats.tailAttempts += metrics.tailAttempts;
      return { level: 2, seed: String(seed), queues: shuffle(queues, random), buffer: [], total: 240, cleared: 0, moves: 0, status: 'playing' };
    }
    stats.failures.push(String(seed));
    throw new Error(`Ramp construction failed after 1000 attempts: ${seed}`);
  }
  return { config, stats, engine: { ...base, createLevel } };
}

const configs = [
  { id: 'ramp6-240-tail3-7-4-1', tailLanes: 3, tailWeights: [7, 4, 1] },
  { id: 'ramp6-240-tail3-16-3-1', tailLanes: 3, tailWeights: [16, 3, 1] },
  { id: 'ramp6-240-tail2-7-4-1', tailLanes: 2, tailWeights: [7, 4, 1] }
];
const overlapConfigs = [
  { id: 'ramp6-240-overlap-tail4-7-4-1', overlapPackets: true, tailLanes: 4, tailWeights: [7, 4, 1] },
  { id: 'ramp6-240-overlap-tail4-16-3-1', overlapPackets: true, tailLanes: 4, tailWeights: [16, 3, 1] },
  { id: 'ramp6-240-overlap-tail6-16-3-1', overlapPackets: true, tailLanes: 6, tailWeights: [16, 3, 1] },
  { id: 'ramp6-240-overlap-tail6-30-2-1', overlapPackets: true, tailLanes: 6, tailWeights: [30, 2, 1] }
];
module.exports = { createRampCandidate, configs, overlapConfigs, splitAt };
