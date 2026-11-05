import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Preserve the deployed group-transfer rules as a historical regression suite.
// Current single-animal rules are covered in engine-rule6.test.mjs.
const E = require('../scripts/fixtures/engine-generator3-rules5.cjs');
const historicalV3 = require('../scripts/fixtures/engine-generator3-rules3.cjs');
const historicalV4 = require('../scripts/fixtures/engine-generator3-rules4.cjs');
const migrationFixtures = require('../scripts/fixtures/rules3-capacity-migrations.json');
const q = index => ({ type: 'queue', index });
const b = { type: 'buffer' };
const g = (species, count) => ({ species, count });
function board(queues, buffer = []) {
  const total = [...queues.flat(), ...buffer].reduce((sum, group) => sum + group.count, 0);
  return { level: 2, seed: 'test', queues, buffer, total, cleared: 0, moves: 0, status: 'playing' };
}

test('tutorial clears in six transfers through the buffer and inputs remain immutable', () => {
  let state = E.createLevel(1, 'tutorial');
  const original = JSON.stringify(state);
  const first = E.applyMove(state, q(0), b);
  assert.equal(JSON.stringify(state), original);
  assert.equal(first.cleared, 0);
  state = E.applyMove(first.state, b, q(1)).state;
  for (const [from, to] of [[q(0), b], [b, q(2)], [q(1), b], [b, q(2)]]) {
    const result = E.applyMove(state, from, to);
    assert.equal(result.ok, true);
    state = result.state;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.cleared, 15);
  assert.equal(state.moves, 6);
  assert.deepEqual(E.legalMoves(state), []);
});

test('tutorial also clears in three direct transfers that each make five', () => {
  let state = E.createLevel(1, 'tutorial');
  for (const [from, to] of [[q(0), q(1)], [q(0), q(2)], [q(1), q(2)]]) {
    const result = E.applyMove(state, from, to);
    assert.equal(result.ok, true);
    assert.equal(result.cleared, 5);
    state = result.state;
  }
  assert.equal(state.status, 'won');
  assert.equal(state.cleared, 15);
  assert.equal(state.moves, 3);
});

test('main queues reject matching transfers below five and all nonmatching transfers', () => {
  const state = board([[g('dog', 1)], [g('dog', 3)], [g('cat', 2)]]);
  const original = JSON.stringify(state);
  for (const to of [q(1), q(2), q(0)]) {
    const result = E.applyMove(state, q(0), to);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
  }
  assert.equal(JSON.stringify(state), original);
  assert.ok(E.legalMoves(state).every(move => move.to.type === 'buffer'));
  const hint = E.getHint(state);
  assert.equal(hint.to.type, 'buffer');
});

test('4 + 3 clears five directly and leaves different exposed species by direction', () => {
  const state = board([[g('dog', 4), g('cat', 1)], [g('dog', 3), g('pig', 1)]]);
  const forward = E.applyMove(state, q(0), q(1));
  assert.equal(forward.cleared, 5);
  assert.deepEqual(forward.state.queues, [[g('cat', 1)], [g('dog', 2), g('pig', 1)]]);
  const reverse = E.applyMove(state, q(1), q(0));
  assert.deepEqual(reverse.state.queues, [[g('dog', 2), g('cat', 1)], [g('pig', 1)]]);
});

test('buffer preserves insertion boundaries and FIFO retrieves one group only', () => {
  let state = board([[g('dog', 1)], [g('dog', 2)], [g('dog', 1), g('cat', 1)]]);
  state = E.applyMove(state, q(0), b).state;
  state = E.applyMove(state, q(1), b).state;
  assert.deepEqual(state.buffer, [g('dog', 1), g('dog', 2)]);
  assert.equal(E.getHead(state, b).count, 1);
  const next = E.applyMove(state, b, q(2));
  assert.deepEqual(next.state.buffer, [g('dog', 2)]);
  assert.equal(next.state.queues[2][0].count, 2);
  assert.equal(E.applyMove(state, { type: 'buffer', index: 1 }, q(2)).ok, false);
});

test('buffer clears across boundaries and partially consumed groups retain a slot', () => {
  const state = board([[g('dog', 3)], [g('cat', 1)]], [g('dog', 4)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 2)]);
});

test('buffer capacity counts animals, so a fifth group can fit and clear', () => {
  const state = board([[g('dog', 1)], [g('cat', 1)]], [g('dog', 1), g('dog', 1), g('dog', 1), g('dog', 1)]);
  assert.ok(E.legalMoves(state).some(move => move.from.index === 0 && move.to.type === 'buffer'));
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, []);
  const other = E.applyMove(state, q(1), b);
  assert.equal(other.ok, true);
  assert.equal(other.state.buffer.length, 5);
  assert.equal(other.state.buffer.reduce((n, group) => n + group.count, 0), 5);
});

test('buffer clears nonadjacent matches away from the head and empty main queues stay closed', () => {
  const state = board([[], [g('cat', 3)]], [g('dog', 1), g('cat', 2), g('pig', 1)]);
  assert.equal(E.applyMove(state, b, q(0)).ok, false);
  const result = E.applyMove(state, q(1), b);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 1), g('pig', 1)]);
  assert.equal(result.state.status, 'lost');
});

test('nonadjacent buffer clears consume earliest matching groups and keep partial boundaries', () => {
  const state = board([[g('cat', 2)], [g('pig', 1)]], [g('cat', 3), g('dog', 1), g('cat', 1)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 1), g('cat', 1)]);
  assert.equal(result.state.moves, 1);
  assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
});

test('five stored animals accept only two from a group of three and leave one at its source', () => {
  const state = board([[g('pig', 3), g('frog', 1)], [g('dog', 1)]], [g('dog', 2), g('cat', 3)]);
  const original = structuredClone(state);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 0);
  assert.deepEqual(result.state.buffer, [g('dog', 2), g('cat', 3), g('pig', 2)]);
  assert.deepEqual(result.state.queues[0], [g('pig', 1), g('frog', 1)]);
  assert.deepEqual(state, original);
  assert.equal(result.state.moves, 1);
  assert.equal(E.BUFFER_CAPACITY, 7);
  assert.equal(E.RULES_VERSION, 5);
  assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
});

test('partial insertion settles after its size is fixed and frees space for the next move', () => {
  const state = board([[g('cat', 3), g('frog', 1)], [g('pig', 3)]], [g('dog', 2), g('cat', 3)]);
  const first = E.applyMove(state, q(0), b);
  assert.equal(first.ok, true);
  assert.equal(first.cleared, 5);
  assert.deepEqual(first.state.buffer, [g('dog', 2)]);
  assert.deepEqual(first.state.queues[0], [g('cat', 1), g('frog', 1)]);
  const second = E.applyMove(first.state, q(1), b);
  assert.equal(second.ok, true);
  assert.deepEqual(second.state.buffer, [g('dog', 2), g('pig', 3)]);
  assert.equal(E.remaining(second.state) + second.state.cleared, state.total);
});

test('a full buffer with three pandas accepts two pandas and immediately clears five', () => {
  const state = board([[g('panda', 2), g('frog', 1)]], [g('cat', 2), g('panda', 3), g('dog', 2)]);
  const original = structuredClone(state);
  assert.ok(E.legalMoves(state).some(move => move.from.index === 0 && move.to.type === 'buffer'));
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('cat', 2), g('dog', 2)]);
  assert.deepEqual(result.state.queues[0], [g('frog', 1)]);
  assert.equal(result.state.moves, 1);
  assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
  assert.deepEqual(state, original);
});

test('full-buffer five-clears count matching animals across separated FIFO groups', () => {
  const state = board([[g('panda', 2), g('frog', 1)]], [g('panda', 1), g('dog', 2), g('panda', 2), g('cat', 2)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 2), g('cat', 2)]);
  assert.deepEqual(result.state.queues[0], [g('frog', 1)]);
  assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
});

test('full-buffer rescue takes only the animals needed for five and leaves every surplus at its source', () => {
  for (const existing of [1, 2, 3, 4]) {
    const other = [g('dog', 3), ...(existing < 4 ? [g('cat', 4 - existing)] : [])];
    const state = board([[g('panda', 4), g('frog', 1)]], [g('panda', existing), ...other]);
    const result = E.applyMove(state, q(0), b);
    assert.equal(result.ok, true, `stored pandas: ${existing}`);
    assert.equal(result.cleared, 5);
    assert.deepEqual(result.state.buffer, other);
    assert.deepEqual(result.state.queues[0], [...(existing > 1 ? [g('panda', existing - 1)] : []), g('frog', 1)]);
    assert.equal(result.state.moves, 1);
    assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
  }
});

test('one free slot may accept two for a five-clear but never refills space freed by that clear', () => {
  const state = board([[g('panda', 3), g('frog', 1)]], [g('dog', 3), g('panda', 3)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.cleared, 5);
  assert.deepEqual(result.state.buffer, [g('dog', 3)]);
  assert.deepEqual(result.state.queues[0], [g('panda', 1), g('frog', 1)]);
  assert.equal(E.remaining(result.state) + result.state.cleared, state.total);
});

test('a full buffer still rejects animals that cannot complete five', () => {
  const state = board([[g('rabbit', 4)], [g('dog', 1)]], [g('dog', 3), g('cat', 4)]);
  for (const from of [q(0), q(1)]) {
    const result = E.applyMove(state, from, b);
    assert.equal(result.ok, false);
    assert.equal(result.state, state);
    assert.equal(result.cleared, 0);
  }
  assert.ok(E.legalMoves(state).every(move => move.to.type !== 'buffer'));
  const retrieved = E.applyMove(state, b, q(1));
  assert.equal(retrieved.ok, true);
  assert.deepEqual(retrieved.state.queues[1], [g('dog', 4)]);
  assert.deepEqual(retrieved.state.buffer, [g('cat', 4)]);
});

test('a newly full buffer remains playable when its only legal move is a five-clear rescue', () => {
  const state = board([[g('panda', 2)], [g('pig', 1)]], [g('dog', 3), g('panda', 3)]);
  const filled = E.applyMove(state, q(1), b);
  assert.equal(filled.ok, true);
  assert.equal(filled.state.status, 'playing');
  assert.deepEqual(E.legalMoves(filled.state), [{ from: q(0), to: b }]);
  assert.deepEqual(E.getHint(filled.state), { from: q(0), to: b });
  const rescued = E.applyMove(filled.state, q(0), b);
  assert.equal(rescued.ok, true);
  assert.equal(rescued.cleared, 5);
  assert.deepEqual(rescued.state.buffer, [g('dog', 3), g('pig', 1)]);
  assert.equal(E.remaining(rescued.state) + rescued.state.cleared, state.total);
});

test('seven one-animal groups fit while full-buffer direct main matches remain legal', () => {
  const buffer = ['dog', 'cat', 'pig', 'frog', 'sheep', 'duck'].map(type => g(type, 1));
  const state = board([[g('rabbit', 1)], [g('cow', 2)], [g('cow', 3)]], buffer);
  const filled = E.applyMove(state, q(0), b);
  assert.equal(filled.ok, true);
  assert.equal(filled.state.buffer.length, 7);
  assert.equal(filled.state.status, 'playing');
  const matched = E.applyMove(filled.state, q(1), q(2));
  assert.equal(matched.ok, true);
  assert.equal(matched.cleared, 5);
  assert.equal(matched.state.buffer.length, 7);
});

test('settlement cascades only through queue heads', () => {
  const state = board([[g('dog', 2)], [g('dog', 3), g('cat', 5), g('pig', 1), g('frog', 5)]]);
  const result = E.applyMove(E.applyMove(state, q(0), b).state, b, q(1));
  assert.equal(result.cleared, 10);
  assert.deepEqual(result.state.queues[1], [g('pig', 1), g('frog', 5)]);
});

test('filling the seventh animal reports loss when no legal operation remains', () => {
  const state = board([[g('frog', 3)]], [g('dog', 2), g('cat', 2), g('pig', 2)]);
  const result = E.applyMove(state, q(0), b);
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'lost');
  assert.deepEqual(result.state.queues[0], [g('frog', 2)]);
  assert.deepEqual(E.legalMoves(result.state), []);
});

test('challenge seeds are deterministic, varied, and preserve all quotas', () => {
  assert.deepEqual(E.createLevel(2, 'river'), E.createLevel(2, 'river'));
  assert.notDeepEqual(E.createLevel(2, 'river').queues, E.createLevel(2, 'forest').queues);
  for (let seed = 0; seed < 2000; seed++) {
    const state = E.createLevel(2, seed);
    const totals = {};
    assert.equal(state.queues.length, 6);
    assert.equal(E.remaining(state), 240);
    for (const queue of state.queues) {
      assert.ok(queue.length > 0);
      queue.forEach((group, index) => {
        assert.ok(group.count > 0 && group.count <= 4);
        assert.notEqual(group.species, queue[index + 1]?.species);
        totals[group.species] = (totals[group.species] || 0) + group.count;
      });
    }
    assert.equal(Object.keys(totals).length, 8);
    assert.ok(Object.values(totals).every(count => count === 30));
    assert.equal(E.legalMoves(state).filter(move => move.to.type === 'buffer').length, 6, `seed ${seed} can store each main head`);
    assert.ok(E.legalMoves(state).some(move => move.to.type === 'queue'), `seed ${seed} has an opening five-clear`);
  }
});

test('generator one preserves historical seed layouts and unversioned saves', () => {
  const fixtures = {
    '0': 'b3e68f54f378e3fb27e8f3c07a4518afc76518585e675daf5379fd0ebc38b75c',
    river: 'c44c4f03f9c0d49b98babe1a113d2e5b72f17949cb88ff228943628df4a88c8f',
    forest: '7909135d7a4995c7a7c457e64d618ccafba1ce7deb85b6f59e6e649318def91e',
  };
  for (const [seed, expected] of Object.entries(fixtures)) {
    const original = E.createLevel(2, seed, 1);
    assert.equal(createHash('sha256').update(JSON.stringify(original.queues)).digest('hex'), expected);
    assert.equal(original.generatorVersion, 1);
    assert.deepEqual(E.restoreReplay(2, seed, []), original);
    assert.deepEqual(E.createLevel(original.level, original.seed, original.generatorVersion), original);
    assert.notDeepEqual(E.createLevel(2, seed).queues, original.queues);
  }
});

test('generator two preserves deployed layouts and saved progress', () => {
  const fixtures = {
    '0': '830fa7524024cd5be5ff1a5fbb3ecc0a2519ce6c5fb2105a1051727cec192858',
    river: '7e3b9186289d28201c05e844293ed111d332a6c38661556b021c7d76818f2e1c',
    forest: '70c7908e5c49b8d31d202508f4f143e115478fc1edf9ebf1f9d9d21ea817da1c',
  };
  for (const [seed, expected] of Object.entries(fixtures)) {
    let live = E.createLevel(2, seed, 2);
    const original = structuredClone(live);
    assert.equal(createHash('sha256').update(JSON.stringify(live.queues)).digest('hex'), expected);
    assert.equal(live.total, 160);
    const history = [];
    for (let step = 0; step < 50 && live.status === 'playing'; step++) {
      const { from, to } = E.getHint(live);
      live = E.applyMove(live, from, to).state;
      history.push({ from, to, rulesVersion: E.RULES_VERSION });
      assert.deepEqual(E.restoreReplay(2, seed, JSON.parse(JSON.stringify(history)), 2), live);
    }
    assert.deepEqual(E.createLevel(live.level, live.seed, live.generatorVersion), original);
  }
});

test('new generator saves round-trip through JSON and preserve every move', () => {
  assert.equal(E.GENERATOR_VERSION, 3);
  let live = E.createLevel(2, 'new-save');
  assert.equal(live.generatorVersion, 3);
  const history = [];
  for (let step = 0; step < 40 && live.status === 'playing'; step++) {
    const { from, to } = E.getHint(live);
    live = E.applyMove(live, from, to).state;
    history.push({ from, to, rulesVersion: E.RULES_VERSION });
    const saved = JSON.parse(JSON.stringify({ level: live.level, seed: live.seed, generatorVersion: live.generatorVersion, history }));
    assert.deepEqual(E.restoreReplay(saved.level, saved.seed, saved.history, saved.generatorVersion), live);
  }
  assert.ok(live.cleared > 0);
  assert.deepEqual(E.createLevel(live.level, live.seed, live.generatorVersion), E.createLevel(2, 'new-save'));
});

test('unknown generation versions are rejected and tutorial remains version one', () => {
  for (const version of [0, 4, '3', null]) {
    assert.throws(() => E.createLevel(2, 'river', version), /未知的盘面生成版本/);
    assert.throws(() => E.restoreReplay(2, 'river', [], version), /未知的盘面生成版本/);
  }
  assert.equal(E.createLevel(1, 'tutorial').generatorVersion, 1);
  assert.deepEqual(E.createLevel(1, 'tutorial', 2), E.createLevel(1, 'tutorial', 1));
  assert.deepEqual(E.createLevel(1, 'tutorial', 3), E.createLevel(1, 'tutorial', 1));
});

test('random legal games conserve animals and capacity after every operation', () => {
  for (let seed = 0; seed < 60; seed++) {
    let state = E.createLevel(2, seed);
    for (let step = 0; step < 150 && state.status === 'playing'; step++) {
      const moves = E.legalMoves(state);
      const move = step % 4 === 0 ? moves[(step + seed) % moves.length] : E.getHint(state);
      assert.ok(move);
      if (move.from.type === 'queue' && move.to.type === 'queue') {
        assert.equal(E.getHead(state, move.from).species, E.getHead(state, move.to).species);
        assert.ok(E.getHead(state, move.from).count + E.getHead(state, move.to).count >= 5);
      }
      const result = E.applyMove(state, move.from, move.to);
      assert.equal(result.ok, true);
      state = result.state;
      assert.equal(E.remaining(state) + state.cleared, state.total);
      assert.ok(state.buffer.reduce((n, group) => n + group.count, 0) <= 7);
      assert.equal(state.cleared % 5, 0);
      for (const queue of state.queues) assert.ok(!queue.length || queue[0].count < 5);
      const buffered = {};
      for (const group of state.buffer) buffered[group.species] = (buffered[group.species] || 0) + group.count;
      assert.ok(Object.values(buffered).every(count => count < 5));
    }
  }
});

test('legacy replay preserves old sub-five transfers and accepts new continuation', () => {
  const history = [{ from: q(2), to: q(3) }];
  const original = JSON.stringify(history);
  const start = E.createLevel(2, '0', 1);
  assert.equal(E.applyMove(start, q(2), q(3)).ok, false);
  const restored = E.restoreReplay(2, '0', history);
  assert.equal(restored.moves, 1);
  assert.equal(restored.cleared, 0);
  assert.deepEqual(restored.queues[2], start.queues[2].slice(1));
  assert.deepEqual(restored.queues[3][0], g('fox', 4));
  assert.equal(restored.status, 'playing');
  const stored = E.applyMove(restored, q(3), b);
  const continued = E.applyMove(stored.state, b, q(4));
  assert.equal(continued.ok, true);
  assert.equal(continued.cleared, 5);
  assert.deepEqual(E.restoreReplay(2, '0', [...history, { from: q(3), to: b, rulesVersion: E.RULES_VERSION }, { from: b, to: q(4), rulesVersion: E.RULES_VERSION }]), continued.state);
  assert.equal(JSON.stringify(history), original);
});

test('old buffer positions upgrade after all historical moves, returning only the excess to its origin', () => {
  const history = [1, 3, 3, 0].map(index => ({ from: q(index), to: b }));
  const restored = E.restoreReplay(2, '0', history);
  assert.deepEqual(restored.buffer, [g('rabbit', 4), g('pig', 2), g('fox', 1)]);
  assert.deepEqual(restored.queues[0][0], g('fox', 1));
  assert.deepEqual(restored.queues[2][0], g('fox', 1));
  assert.deepEqual(restored.queues[4][0], g('fox', 2));
  assert.equal(restored.status, 'lost');
  assert.equal(restored.cleared, 5);
  assert.equal(restored.moves, 4);
  assert.equal(E.remaining(restored) + restored.cleared, 160);
  // The old sub-five transfer still replays before upgrading the buffered animals.
  const continued = E.restoreReplay(2, '0', [...history, { from: q(2), to: q(4) }]);
  assert.equal(continued.moves, 5);
  assert.equal(continued.cleared, 5);
  assert.deepEqual(continued.queues[4][0], g('fox', 3));
  assert.deepEqual(continued.buffer, restored.buffer);
  assert.equal(continued.status, 'playing');
  for (const rulesVersion of [1, 2, 3]) {
    const versioned = E.restoreReplay(2, '0', history.map(move => ({ ...move, rulesVersion })));
    assert.deepEqual(versioned, restored);
  }
});

test('v3 directly to current rules still migrates capacity and stays stable after every refresh', () => {
  const history = [0, 1, 2].map(index => ({ from: q(index), to: b, rulesVersion: 3 }));
  let live = E.restoreReplay(2, '0', history, 3);
  const upgraded = structuredClone(live);
  assert.equal(live.cleared, 0);
  assert.deepEqual(live.buffer, [g('penguin', 3), g('turtle', 2), g('fox', 2)]);
  assert.deepEqual(live.queues[2].slice(0, 2), [g('fox', 1), g('turtle', 3)]);
  for (const [from, to] of [[b, q(5)], [q(2), b], [q(1), q(4)]]) {
    const result = E.applyMove(live, from, to);
    assert.equal(result.ok, true);
    live = result.state;
    history.push({ from, to, rulesVersion: E.RULES_VERSION });
    for (let refresh = 0; refresh < 3; refresh++) assert.deepEqual(E.restoreReplay(2, '0', JSON.parse(JSON.stringify(history)), 3), live);
    assert.equal(E.remaining(live) + live.cleared, 240);
  }
  assert.equal(live.cleared, 10);
  assert.equal(live.moves, 6);
  assert.deepEqual(live.buffer, [g('turtle', 2), g('fox', 2), g('fox', 1)]);
  assert.deepEqual(E.restoreReplay(2, '0', history.slice(0, 3).map(move => ({ ...move, rulesVersion: 2 })), 3), upgraded);
});

test('legacy head-only buffer replay does not prematurely clear middle species', () => {
  const history = [0, 0, 2, 1].map(index => ({ from: q(index), to: b }));
  const restored = E.restoreReplay(1, 'tutorial', history);
  assert.equal(restored.cleared, 10);
  assert.deepEqual(restored.buffer, []);
  assert.deepEqual(restored.queues, [[], [g('dog', 2)], [g('dog', 3)]]);
  assert.equal(restored.moves, 4);
  const historicalEnd = E.restoreReplay(1, 'tutorial', [...history, { from: q(1), to: q(2) }]);
  assert.equal(historicalEnd.status, 'won');
  assert.equal(historicalEnd.cleared, 15);
  assert.equal(historicalEnd.moves, 5);
});

test('old FIFO retrievals replay before the upgrade changes matching group counts', () => {
  const history = [1, 3, 3, 0].map(index => ({ from: q(index), to: b }));
  history.push({ from: q(2), to: q(4) }, { from: b, to: q(2) }, { from: b, to: q(4) });
  // An early global clear would consume the fox group that the seventh old move needs.
  const restored = E.restoreReplay(2, '0', history);
  assert.equal(restored.moves, 7);
  assert.equal(restored.cleared, 10);
  assert.deepEqual(restored.buffer, [g('pig', 2), g('fox', 4)]);
  assert.deepEqual(restored.queues[4][0], g('fox', 1));
  assert.equal(E.remaining(restored) + restored.cleared, 160);
});

test('historical v3 fixtures preserve FIFO prefixes, return surplus in source order and reopen closed sources', () => {
  for (const [name, fixture] of Object.entries(migrationFixtures)) {
    const { seed, generatorVersion, history, before, after, returned } = fixture;
    const old = historicalV3.restoreReplay(2, seed, history, generatorVersion);
    assert.deepEqual(old.buffer, before.buffer, name);
    assert.deepEqual(old.queues, before.queues, name);
    const live = E.restoreReplay(2, seed, history, generatorVersion);
    assert.deepEqual(live.buffer, after.buffer, name);
    assert.deepEqual(live.queues, after.queues, name);
    assert.equal(live.cleared, after.cleared, name);
    assert.equal(live.moves, old.moves, name);
    assert.equal(E.remaining(live) + live.cleared, old.total, name);
    const expand = groups => groups.flatMap(group => Array(group.count).fill(group.species));
    assert.deepEqual(expand(live.buffer), expand(old.buffer).slice(0, 7), name);
    if (name === 'reopensClosedSource') {
      assert.deepEqual(old.queues[0], []);
      assert.deepEqual(live.queues[0], [g('dog', 1), g('sheep', 1)]);
    }
    if (name === 'multipleGroupsSameSource') {
      assert.equal(returned[0].origin, returned[1].origin);
      assert.deepEqual(live.queues[1].slice(0, 2), [g('chicken', 1), g('cat', 1)]);
    }
    const continuedHistory = JSON.parse(JSON.stringify(history));
    let continued = live;
    for (let step = 0; step < 10 && continued.status === 'playing'; step++) {
      const move = E.getHint(continued);
      continued = E.applyMove(continued, move.from, move.to).state;
      continuedHistory.push({ ...move, rulesVersion: E.RULES_VERSION });
      assert.deepEqual(E.restoreReplay(2, seed, JSON.parse(JSON.stringify(continuedHistory)), generatorVersion), continued, name);
    }
  }
});

test('version-three replay remains exact when no capacity migration is needed', () => {
  for (const generatorVersion of [1, 2, 3]) {
    const seed = `historical-version-three:${generatorVersion}`;
    let old = historicalV3.createLevel(2, seed, generatorVersion);
    const history = [];
    for (let step = 0; step < 45 && old.status === 'playing'; step++) {
      const move = historicalV3.getHint(old);
      old = historicalV3.applyMove(old, move.from, move.to).state;
      history.push({ ...move, rulesVersion: 3 });
      if (old.buffer.reduce((n, group) => n + group.count, 0) <= 7) {
        const restored = E.restoreReplay(2, seed, history, generatorVersion);
        assert.deepEqual({ ...restored, status: old.status }, old);
      }
    }
  }
});

test('version-four history replays with its frozen hard-capacity behavior', () => {
  assert.equal(historicalV4.RULES_VERSION, 4);
  for (const generatorVersion of [1, 2, 3]) {
    const seed = `historical-version-four:${generatorVersion}`;
    let old = historicalV4.createLevel(2, seed, generatorVersion);
    const history = [];
    for (let step = 0; step < 60 && old.status === 'playing'; step++) {
      const moves = historicalV4.legalMoves(old);
      const move = step % 4 === 0 ? moves[(step + generatorVersion) % moves.length] : historicalV4.getHint(old);
      const result = historicalV4.applyMove(old, move.from, move.to);
      assert.equal(result.ok, true);
      old = result.state;
      history.push({ ...move, rulesVersion: 4 });
      const restored = E.restoreReplay(2, seed, JSON.parse(JSON.stringify(history)), generatorVersion);
      // Current rules may restore a rescue move to an old lost board, but must
      // preserve every animal, group boundary, historical clear and move count.
      assert.deepEqual({ ...restored, status: old.status }, old);
    }
  }
});

test('a frozen v4 loss gains only the v5 rescue move and continued saves survive every refresh', () => {
  const seed = '1';
  const history = [5, 4].map(index => ({ from: q(index), to: b, rulesVersion: 4 }));
  const historical = historicalV4.restoreReplay(2, seed, history, 3);
  assert.equal(historical.status, 'lost');
  assert.deepEqual(historical.buffer, [g('panda', 3), g('duck', 4)]);
  let live = E.restoreReplay(2, seed, history, 3);
  assert.deepEqual({ ...live, status: historical.status }, historical);
  assert.equal(live.status, 'playing');
  assert.deepEqual(E.legalMoves(live), [{ from: q(1), to: b }]);
  const rescue = { from: q(1), to: b };
  assert.throws(() => E.restoreReplay(2, seed, [...history, { ...rescue, rulesVersion: 4 }], 3));
  const rescued = E.applyMove(live, rescue.from, rescue.to);
  assert.equal(rescued.ok, true);
  assert.equal(rescued.cleared, 5);
  assert.deepEqual(rescued.state.buffer, [g('panda', 3)]);
  live = rescued.state;
  history.push({ ...rescue, rulesVersion: E.RULES_VERSION });
  const next = E.getHint(live);
  assert.ok(next);
  assert.throws(() => E.restoreReplay(2, seed, [...history, { ...next, rulesVersion: 4 }], 3));
  for (let step = 0; step < 12; step++) {
    for (let refresh = 0; refresh < 3; refresh++) {
      assert.deepEqual(E.restoreReplay(2, seed, JSON.parse(JSON.stringify(history)), 3), live);
    }
    assert.equal(E.remaining(live) + live.cleared, 240);
    if (live.status !== 'playing') break;
    const move = E.getHint(live);
    const result = E.applyMove(live, move.from, move.to);
    assert.equal(result.ok, true);
    live = result.state;
    history.push({ ...move, rulesVersion: E.RULES_VERSION });
  }
  assert.deepEqual(E.restoreReplay(2, seed, JSON.parse(JSON.stringify(history)), 3), live);
});

test('replay rejects illegal history instead of silently replacing a saved game', () => {
  assert.throws(() => E.restoreReplay(1, 'tutorial', null));
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: q(2) }]));
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: b, to: q(0) }]));
  assert.throws(() => E.restoreReplay(1, 'tutorial', [null]));
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: b, rulesVersion: 99 }]));
  assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: b, rulesVersion: 3 }, { from: b, to: q(1) }]));
  for (const rulesVersion of [undefined, 1, 2, 3]) assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: b, rulesVersion: 4 }, { from: b, to: q(1), rulesVersion }]));
  for (const rulesVersion of [undefined, 1, 2, 3, 4]) assert.throws(() => E.restoreReplay(1, 'tutorial', [{ from: q(0), to: b, rulesVersion: E.RULES_VERSION }, { from: b, to: q(1), rulesVersion }]));
  assert.throws(() => E.restoreReplay(2, '0', [{ from: q(2), to: q(3), rulesVersion: 3 }]));
  const won = [{ from: q(0), to: q(1) }, { from: q(0), to: q(2) }, { from: q(1), to: q(2) }];
  assert.equal(E.restoreReplay(1, 'tutorial', won).status, 'won');
  assert.throws(() => E.restoreReplay(1, 'tutorial', [...won, { from: q(1), to: b }]));
});
