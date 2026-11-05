'use strict';

const frozen = require('./simulate.cjs');
const base = require('../dist/engine.js');
const POLICY_VERSION = 'visible3-one-clear-plan-v1';
const unknown = group => !group || group.species.startsWith('__hidden_tail__');
const signature = state => JSON.stringify([state.cleared, state.queues.map(queue => queue.slice(0, 3).map(group => [group.species, group.count])), state.buffer.map(group => [group.species, group.count])]);

function randomFor(seed) {
  let value = 2166136261;
  for (const char of String(seed)) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function planOneClear(observation, engine, seen, random) {
  const totals = new Map();
  for (const group of [...observation.queues.map(queue => queue[0]), ...observation.buffer]) {
    if (!unknown(group)) totals.set(group.species, (totals.get(group.species) || 0) + group.count);
  }
  const goals = [];
  for (const [type, count] of totals) {
    if (count < 5) continue;
    const visited = new Set([signature(observation)]);
    let frontier = [{ state: observation, moves: [] }];
    for (let depth = 1; depth <= 5 && frontier.length; depth++) {
      const nextFrontier = [];
      for (const node of frontier) {
        for (const move of engine.legalMoves(node.state)) {
          const head = engine.getHead(node.state, move.from);
          if (unknown(head) || head.species !== type) continue;
          const result = engine.applyMove(node.state, move.from, move.to);
          if (!result.ok) continue;
          const key = signature(result.state);
          if (visited.has(key) || seen.has(key)) continue;
          visited.add(key);
          const moves = [...node.moves, move];
          if (result.cleared >= 5) goals.push({ moves, state: result.state, cleared: result.cleared, tie: random() });
          else if (result.state.status === 'playing') nextFrontier.push({ state: result.state, moves });
        }
      }
      // A breadth-first search needs no longer routes after a clear at this depth.
      if (goals.some(goal => goal.moves.length === depth)) break;
      frontier = nextFrontier;
    }
  }
  goals.sort((a, b) => a.moves.length - b.moves.length || b.cleared - a.cleared || a.state.buffer.length - b.state.buffer.length || b.state.queues.filter(q => q.length).length - a.state.queues.filter(q => q.length).length || b.tie - a.tie);
  return goals[0] || null;
}

function runGame(seed, supplied = {}) {
  const options = { ...frozen.defaults, ...supplied };
  const engine = options.engine || base;
  let state = options.createState ? options.createState(seed, engine) : engine.createLevel(2, seed);
  const random = randomFor(`${options.tiePrefix}|${seed}`), seen = new Set(), history = [];
  let lastClearMove = 0, reason = null, plannedActions = 0, fallbackActions = 0;
  while (state.status === 'playing' && state.moves < options.maxSteps) {
    if (state.moves - lastClearMove >= options.stallLimit) { reason = 'clear_stall_limit'; break; }
    const observation = frozen.observe(state);
    seen.add(signature(observation));
    const plan = planOneClear(observation, engine, seen, random);
    const move = plan ? plan.moves[0] : frozen.chooseMove(observation, engine, seen, random, options);
    if (!move) { reason = 'all_visible_successors_seen'; break; }
    const result = engine.applyMove(state, move.from, move.to);
    if (!result.ok) throw new Error(`Illegal planned move: ${seed}`);
    if (plan) plannedActions++; else fallbackActions++;
    state = result.state;
    if (result.cleared) lastClearMove = state.moves;
    if (options.trace) history.push({ ...move, cleared: result.cleared, rulesVersion: engine.RULES_VERSION, planned: !!plan, plannedSteps: plan?.moves.length || 0 });
  }
  const outcome = state.status === 'won' ? 'won' : state.status === 'lost' ? 'lost' : reason ? 'no_progress' : 'cap';
  const result = { seed: String(seed), tieSeed: `${options.tiePrefix}|${seed}`, outcome,
    stopReason: reason || (outcome === 'cap' ? 'max_steps' : 'engine_terminal'),
    cleared: state.cleared, total: state.total, clearedFraction: state.cleared / state.total,
    moves: state.moves, reachedThreshold: state.cleared >= options.threshold,
    activeQueues: state.queues.filter(q => q.length).length,
    bufferGroups: state.buffer.length, bufferAnimals: state.buffer.reduce((n, g) => n + g.count, 0),
    movesSinceLastClear: state.moves - lastClearMove, plannedActions, fallbackActions };
  if (options.trace) result.history = history;
  return result;
}

module.exports = { runGame, planOneClear, POLICY_VERSION };
