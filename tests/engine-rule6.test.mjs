import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../dist/engine.js');
const historicalV5 = require('../scripts/fixtures/engine-generator3-rules5.cjs');
const q = index => ({ type: 'queue', index });
const b = { type: 'buffer' };
const g = (species, count) => ({ species, count });
const count = groups => groups.reduce((total, group) => total + group.count, 0);
const jsonCopy = value => JSON.parse(JSON.stringify(value));

function board(queues, buffer = []) {
  return { level: 2, seed: 'test', queues, buffer, total: count([...queues.flat(), ...buffer]), cleared: 0, moves: 0, status: 'playing' };
}

function assertConserved(state) {
  assert.equal(E.remaining(state) + state.cleared, state.total);
  assert.ok(count(state.buffer) <= 7);
  assert.equal(state.cleared % 5, 0);
}

function assertRejected(state, from, to) {
  const original = structuredClone(state);
  const result = E.applyMove(state, from, to);
  assert.equal(result.ok, false);
  assert.equal(result.state, state);
  assert.equal(result.cleared, 0);
  assert.deepEqual(state, original);
}

test('rule 6 moves exactly one top animal per click and exposes the next group only after its last animal', () => {
  let state = board([[g('panda', 3), g('frog', 2)], [g('dog', 1)]]);
  const original = structuredClone(state);
  const first = E.applyMove(state, q(0), b);
  assert.equal(E.RULES_VERSION, 6);
  assert.equal(E.BUFFER_CAPACITY, 7);
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.queues[0], [g('panda', 2), g('frog', 2)]);
  assert.deepEqual(first.state.buffer, [g('panda', 1)]);
  assert.deepEqual(state, original);
  state = first.state;
  for (let remaining = 1; remaining >= 0; remaining--) {
    const result = E.applyMove(state, q(0), b);
    assert.equal(result.ok, true);
    assert.equal(result.cleared, 0);
    state = result.state;
    assert.deepEqual(state.queues[0], [...(remaining ? [g('panda', remaining)] : []), g('frog', 2)]);
    assertConserved(state);
  }
  assert.deepEqual(state.buffer, [g('panda', 1), g('panda', 1), g('panda', 1)]);
  assert.equal(state.moves, 3);
});

test('rule 6 returns only the first buffer animal, including a multi-animal group from an old save', () => {
  const state = board([[g('panda', 1), g('frog', 1)], [g('dog', 2)]], [g('panda', 3), g('dog', 1)]);
  const original = structuredClone(state);
  const first = E.applyMove(state, b, q(0));
  assert.equal(first.ok, true);
  assert.deepEqual(first.state.buffer, [g('panda', 2), g('dog', 1)]);
  assert.deepEqual(first.state.queues[0], [g('panda', 2), g('frog', 1)]);
  assert.equal(first.cleared, 0);
  assert.equal(first.state.moves, 1);
  assert.deepEqual(state, original);
  assertConserved(first.state);
  assertRejected(first.state, b, q(1));
  assertRejected(first.state, { type: 'buffer', index: 1 }, q(1));
  const second = E.applyMove(first.state, b, q(0));
  assert.equal(second.ok, true);
  assert.deepEqual(second.state.buffer, [g('panda', 1), g('dog', 1)]);
  assert.deepEqual(second.state.queues[0], [g('panda', 3), g('frog', 1)]);
  assertConserved(second.state);
  const third = E.applyMove(second.state, b, q(0));
  assert.equal(third.ok, true);
  assert.deepEqual(third.state.buffer, [g('dog', 1)]);
  assert.deepEqual(third.state.queues[0], [g('panda', 4), g('frog', 1)]);
  const nextSpecies = E.applyMove(third.state, b, q(1));
  assert.equal(nextSpecies.ok, true);
  assert.deepEqual(nextSpecies.state.buffer, []);
  assert.deepEqual(nextSpecies.state.queues[1], [g('dog', 3)]);
  assertConserved(nextSpecies.state);
});

test('rule 6 refuses every top-to-top transfer, even a matching pair that would make five', () => {
  const state = board([[g('panda', 4)], [g('panda', 1)], [g('cat', 2)]]);
  for (const [from, to] of [[q(0), q(1)], [q(1), q(0)], [q(0), q(2)], [q(0), q(0)]]) {
    assertRejected(state, from, to);
  }
  assert.ok(E.legalMoves(state).every(move => move.from.type === 'queue' && move.to.type === 'buffer'));
  assert.equal(E.getHint(state).to.type, 'buffer');
});

test('rule 6 clears five matching buffer animals across separated groups after a single insertion', () => {
  const state = board([[g('panda', 3), g('frog', 1)]], [g('panda', 1), g('dog', 1), g('panda', 2), g('cat', 1), g('panda', 1)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 1), g('cat', 1)]);
  assert.deepEqual(result.state.queues[0], [g('panda', 2), g('frog', 1)]);
  assert.equal(result.state.moves, 1);
  assertConserved(result.state);
});

test('rule 6 allows the eighth animal only when that single animal immediately completes five', () => {
  const state = board([[g('panda', 3), g('frog', 1)]], [g('dog', 3), g('panda', 1), g('panda', 3)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 3)]);
  assert.deepEqual(result.state.queues[0], [g('panda', 2), g('frog', 1)]);
  assertConserved(result.state);
});

test('rule 6 rejects a full-buffer move needing two matches even when the source holds both', () => {
  const state = board([[g('panda', 2)], [g('rabbit', 4)]], [g('dog', 4), g('panda', 3)]);
  assertRejected(state, q(0), b);
  assertRejected(state, q(1), b);
  assert.deepEqual(E.legalMoves(state), []);
});

test('rule 6 still takes one with free slots and never takes extra animals after a five-clear', () => {
  const state = board([[g('panda', 4), g('frog', 1)]], [g('panda', 4)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, []);
  assert.deepEqual(result.state.queues[0], [g('panda', 3), g('frog', 1)]);
  assertConserved(result.state);
});

test('rule 6 preserves main-head five-clears and cascades after returning a single animal', () => {
  const state = board([[g('panda', 4), g('cat', 5), g('dog', 1), g('frog', 5)]], [g('panda', 2)]);
  const result = E.applyMove(state, b, q(0));
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 10);
  assert.deepEqual(result.state.queues[0], [g('dog', 1), g('frog', 5)]);
  assert.deepEqual(result.state.buffer, [g('panda', 1)]);
  assertConserved(result.state);
});

test('rule 6 keeps empty main queues closed and rejects malformed operations without mutation', () => {
  const state = board([[], [g('panda', 1)], [g('dog', 1)]], [g('panda', 2)]);
  for (const [from, to] of [
    [b, q(0)], [b, q(2)], [b, b], [q(0), b], [q(-1), b], [q(99), b],
    [{ type: 'buffer', index: 1 }, q(1)], [q(1), { type: 'unknown' }], [null, b], [q(1), null]
  ]) assertRejected(state, from, to);
});

test('rule 6 marks loss when filling seven leaves only the former two-animal rescue', () => {
  const state = board([[g('pig', 1)], [g('panda', 2)]], [g('dog', 3), g('panda', 3)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'lost');
  assert.deepEqual(E.legalMoves(result.state), []);
  assert.equal(E.getHint(result.state), null);
  assertRejected(result.state, q(1), b);
  assertConserved(result.state);
});

test('rule 6 keeps a full board playable when a one-animal five-clear is its only move', () => {
  const state = board([[g('pig', 1)], [g('panda', 2)]], [g('dog', 2), g('panda', 4)]);
  const filled = E.applyMove(state, q(0), b);
  assert.equal(filled.ok, true);
  assert.equal(filled.state.status, 'playing');
  assert.deepEqual(E.legalMoves(filled.state), [{ from: q(1), to: b }]);
  const result = E.applyMove(filled.state, q(1), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.queues[1], [g('panda', 1)]);
  assert.deepEqual(result.state.buffer, [g('dog', 2), g('pig', 1)]);
  assertConserved(result.state);
});

test('rule 6 reports victory after the last single-animal five-clear', () => {
  const state = board([[g('panda', 1)]], [g('panda', 4)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'won');
  assert.equal(result.cleared, 5);
  assert.equal(E.remaining(result.state), 0);
  assert.deepEqual(E.legalMoves(result.state), []);
  assertRejected(result.state, q(0), b);
  assertConserved(result.state);
});

test('generators one through three retain their original layouts', () => {
  for (const version of [1, 2, 3]) {
    for (const seed of ['0', 'river', 'forest']) {
      assert.deepEqual(E.createLevel(2, seed, version), historicalV5.createLevel(2, seed, version));
    }
  }
});

test('rule 5 histories retain every group and clear when replayed by the rule 6 engine', () => {
  assert.equal(historicalV5.RULES_VERSION, 5);
  for (const generatorVersion of [1, 2, 3]) {
    const seed = `rule-six-compatibility:${generatorVersion}`;
    let old = historicalV5.createLevel(2, seed, generatorVersion);
    const history = [];
    for (let step = 0; step < 45 && old.status === 'playing'; step++) {
      const moves = historicalV5.legalMoves(old);
      const move = step % 4 === 0 ? moves[(step + generatorVersion) % moves.length] : historicalV5.getHint(old);
      const result = historicalV5.applyMove(old, move.from, move.to);
      assert.equal(result.ok, true);
      old = result.state;
      history.push({ ...move, rulesVersion: 5 });
      const restored = E.restoreReplay(2, seed, jsonCopy(history), generatorVersion);
      // Status follows current legal moves; historical animals and counters must not change.
      assert.deepEqual({ ...restored, status: old.status }, old);
      assertConserved(restored);
    }
  }
});

test('rule 5 grouped buffer saves continue with single returns and survive rule 6 JSON refreshes', () => {
  const seed = '0';
  const history = [{ from: q(0), to: b, rulesVersion: 5 }];
  const old = historicalV5.restoreReplay(2, seed, history, 3);
  assert.deepEqual(old.buffer, [g('penguin', 3)]);
  let live = E.restoreReplay(2, seed, history, 3);
  assert.deepEqual({ ...live, status: old.status }, old);
  const returned = E.applyMove(live, b, q(5));
  assert.equal(returned.ok, true);
  assert.equal(returned.cleared, 0);
  assert.deepEqual(returned.state.buffer, [g('penguin', 2)]);
  assert.equal(returned.state.queues[5][0].count, 3);
  live = returned.state;
  history.push({ from: b, to: q(5), rulesVersion: 6 });
  for (let step = 0; step < 10; step++) {
    for (let refresh = 0; refresh < 3; refresh++) assert.deepEqual(E.restoreReplay(2, seed, jsonCopy(history), 3), live);
    assertConserved(live);
    if (live.status !== 'playing') break;
    const move = E.getHint(live);
    assert.ok(move);
    const result = E.applyMove(live, move.from, move.to);
    assert.equal(result.ok, true);
    live = result.state;
    history.push({ ...move, rulesVersion: 6 });
  }
  assert.deepEqual(E.restoreReplay(2, seed, jsonCopy(history), 3), live);
});

test('rule 6 rejects top-to-top records and rule downgrades while preserving legitimate rule 5 records', () => {
  const oldDirect = { from: q(0), to: q(1), rulesVersion: 5 };
  const old = historicalV5.restoreReplay(1, 'tutorial', [oldDirect]);
  const restored = E.restoreReplay(1, 'tutorial', [oldDirect]);
  assert.deepEqual({ ...restored, status: old.status }, old);
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ ...oldDirect, rulesVersion: 6 }]));
  for (const rulesVersion of [undefined, 1, 2, 3, 4, 5]) {
    assert.throws(() => E.restoreReplay(1, 'tutorial', [
      { from: q(0), to: b, rulesVersion: 6 },
      { from: b, to: q(1), rulesVersion }
    ]));
  }
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: b, rulesVersion: 7 }]));
});

test('generator four is deterministic and each successive level increases its lanes, species and animal total', () => {
  assert.equal(E.GENERATOR_VERSION, 4);
  assert.equal(E.LEVEL_COUNT, 5);
  assert.deepEqual(E.createLevel(2, 'river'), E.createLevel(2, 'river', 4));
  assert.deepEqual(E.createLevel(2, 'river'), E.createLevel(2, 'river'));
  assert.notDeepEqual(E.createLevel(2, 'river').queues, E.createLevel(2, 'forest').queues);
  const started = performance.now();
  const totalsByLevel = [60, 100, 150, 210, 280];
  for (const level of [1, 2, 3, 4, 5]) for (let seed = 0; seed < 64; seed++) {
    const state = E.createLevel(level, seed, 4);
    assert.equal(state.generatorVersion, 4);
    assert.equal(state.queues.length, level + 2);
    assert.equal(state.total, totalsByLevel[level - 1]);
    assert.equal(E.remaining(state), state.total);
    assert.equal(state.cleared, 0);
    assert.deepEqual(state.buffer, []);
    const totals = new Map();
    for (const queue of state.queues) {
      assert.ok(queue.length > 0);
      queue.forEach((group, index) => {
        assert.ok(Number.isInteger(group.count) && group.count > 0);
        assert.ok(E.species.includes(group.species));
        assert.notEqual(group.species, queue[index + 1]?.species);
        totals.set(group.species, (totals.get(group.species) || 0) + group.count);
      });
    }
    assert.equal(totals.size, level + 3);
    assert.ok([...totals.values()].every(total => total === (level + 2) * 5));
    assert.equal(E.legalMoves(state).length, level + 2);
  }
  // A generous guard catches unbounded construction retries, not minor machine differences.
  assert.ok(performance.now() - started < 15000, '320 small boards should generate in under 15 seconds');
});

test('all five current levels are valid while old generators remain limited to their original two levels', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    const state = E.createLevel(level, 'all-levels', 4);
    assert.equal(state.level, level);
    assert.equal(state.generatorVersion, 4);
    assert.deepEqual(E.restoreReplay(level, state.seed, [], 4), state);
  }
  for (const level of [0, 6, '1', null]) assert.throws(() => E.createLevel(level, 'invalid-level', 4));
  for (const version of [1, 2, 3]) {
    for (const level of [3, 4, 5]) assert.throws(() => E.createLevel(level, 'historical-level', version));
    assert.deepEqual(E.createLevel(1, 'tutorial', version), historicalV5.createLevel(1, 'tutorial', version));
  }
  for (const version of [0, 5, '4', null]) assert.throws(() => E.createLevel(2, 'invalid-generator', version));
});

test('generator four current saves replay after every single-animal move', () => {
  let live = E.createLevel(2, 'rule-six-current-save', 4);
  const history = [];
  assert.deepEqual(E.restoreReplay(2, live.seed, history, 4), live);
  for (let step = 0; step < 50 && live.status === 'playing'; step++) {
    const moves = E.legalMoves(live);
    const move = step % 5 === 0 ? moves[step % moves.length] : E.getHint(live);
    assert.ok(move);
    const result = E.applyMove(live, move.from, move.to);
    assert.equal(result.ok, true);
    live = result.state;
    history.push({ ...move, rulesVersion: 6 });
    assert.deepEqual(E.restoreReplay(2, live.seed, jsonCopy(history), 4), live);
    assertConserved(live);
  }
  assert.ok(live.moves > 0);
});
