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
  for (let index = out.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

const queueLength = queue => queue.reduce((sum, group) => sum + group.count, 0);

function tail(selected, config, random, metrics) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    metrics.tailAttempts++;
    const queues = Array.from({ length: config.tailLanes }, () => []);
    const inventory = new Map(selected.map(type => [type, 5]));
    let pending = selected.length * 5;
    while (pending) {
      const choices = [];
      for (const type of selected) {
        if (!inventory.get(type)) continue;
        for (let lane = 0; lane < queues.length; lane++) {
          if (queues[lane].at(-1)?.species !== type) choices.push({ type, lane });
        }
      }
      if (!choices.length) break;
      const { type, lane } = choices[Math.floor(random() * choices.length)];
      const weights = config.tailWeights.slice(0, Math.min(3, inventory.get(type)));
      let draw = random() * weights.reduce((a, b) => a + b, 0), count = 1;
      while (count < weights.length && draw >= weights[count - 1]) draw -= weights[count++ - 1];
      queues[lane].push({ species: type, count });
      inventory.set(type, inventory.get(type) - count);
      pending -= count;
    }
    if (!pending) return queues;
    metrics.tailRejected++;
  }
  throw new Error('Tail adjacency construction exceeded 1000 retries');
}

function addPrefix(queues, selected, config, random, metrics) {
  const pending = [...selected, ...selected, ...selected, ...selected.slice(6)];
  let previousPair = null;
  const initialTailLanes = queues.flatMap((queue, index) => queue.length ? [index] : []);
  while (pending.length) {
    const heads = new Set(queues.filter(queue => queue.length).map(queue => queue[0].species));
    const eligible = shuffle(pending.map((type, index) => ({ type, index })), random).filter(({ type }) => !heads.has(type));
    if (!eligible.length) { metrics.prefixBlocked++; return false; }
    const { type, index } = eligible[0];
    const mustOverlap = config.unique ? (previousPair || initialTailLanes) : null;
    const pairs = [];
    for (let first = 0; first < 5; first++) for (let second = first + 1; second < 5; second++) {
      if (mustOverlap && !mustOverlap.includes(first) && !mustOverlap.includes(second)) continue;
      pairs.push({ lanes: [first, second], length: queueLength(queues[first]) + queueLength(queues[second]), tie: random() });
    }
    pairs.sort((a, b) => a.length - b.length || a.tie - b.tie);
    const pair = pairs[0].lanes;
    const split = shuffle(random() < .8 ? [2, 3] : [1, 4], random);
    pair.forEach((lane, offset) => queues[lane].unshift({ species: type, count: split[offset] }));
    previousPair = pair;
    pending.splice(index, 1);
  }
  return true;
}

function createCandidate(supplied) {
  const config = { tailLanes: 2, tailWeights: [7, 4, 1], unique: false, ...supplied };
  const stats = { boards: 0, failures: [], prefixAttempts: 0, prefixBlocked: 0, tailAttempts: 0, tailRejected: 0, maxPrefixAttempts: 0, maxTailAttempts: 0, attemptsBySeed: [] };
  function createLevel(level, seed) {
    if (level === 1) return base.createLevel(level, seed);
    if (level !== 2) throw new Error('Level must be 1 or 2');
    const random = randomFor(seed), selected = shuffle(base.species, random).slice(0, 8);
    const metrics = { tailAttempts: 0, tailRejected: 0, prefixBlocked: 0 };
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const queues = tail(selected.slice(0, 6), config, random, metrics);
      while (queues.length < 5) queues.push([]);
      if (!addPrefix(queues, selected, config, random, metrics)) continue;
      stats.boards++;
      stats.prefixAttempts += attempt;
      stats.prefixBlocked += metrics.prefixBlocked;
      stats.tailAttempts += metrics.tailAttempts;
      stats.tailRejected += metrics.tailRejected;
      stats.maxPrefixAttempts = Math.max(stats.maxPrefixAttempts, attempt);
      stats.maxTailAttempts = Math.max(stats.maxTailAttempts, metrics.tailAttempts);
      stats.attemptsBySeed.push({ seed, prefixAttempts: attempt, ...metrics });
      return { level: 2, seed: String(seed), queues: shuffle(queues, random), buffer: [], total: 160, cleared: 0, moves: 0, status: 'playing' };
    }
    stats.failures.push(String(seed));
    throw new Error(`Prefix construction exceeded 1000 retries for seed ${seed}`);
  }
  return { config, stats, engine: { ...base, createLevel } };
}

const configs = [];
for (const unique of [false, true]) {
  for (const tailWeights of [[7, 4, 1], [9, 3, 1], [9, 2, 1]]) {
    configs.push({ id: `${unique ? 'unique' : 'head-exclusion'}-tail2-${tailWeights.join('-')}`, unique, tailLanes: 2, tailWeights });
  }
  configs.push({ id: `${unique ? 'unique' : 'head-exclusion'}-tail1-7-4-1`, unique, tailLanes: 1, tailWeights: [7, 4, 1] });
}

// These later calibration candidates use the same frozen generation functions.
for (const tailWeights of [[15, 2, 1], [20, 2, 1], [30, 2, 1], [30, 1, 1]]) {
  configs.push({ id: `unique-tail2-${tailWeights.join('-')}`, unique: true, tailLanes: 2, tailWeights });
}
configs.push({ id: 'head-exclusion-tail2-30-2-1', unique: false, tailLanes: 2, tailWeights: [30, 2, 1] });

module.exports = { createCandidate, configs };
