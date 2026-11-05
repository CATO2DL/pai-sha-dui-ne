import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { choose } = require('../scripts/validate-single-policy.cjs');

test('evaluation policy never reads species behind the first four visible animals, including fallback', () => {
  const hidden = {};
  Object.defineProperty(hidden, 'species', { get() { throw new Error('Hidden animal read'); } });
  Object.defineProperty(hidden, 'count', { get() { throw new Error('Hidden count read'); } });
  const make = tail => ({ queues: [
    ...['panda', 'cat', 'pig'].map(type => [
      { species: type, count: 1 }, { species: 'frog', count: 1 },
      { species: 'sheep', count: 1 }, { species: 'dog', count: 1 }, tail
    ])
  ], buffer: [{ species: 'duck', count: 1 }], status: 'playing' });
  const safe = choose(make({ species: 'cow', count: 3 }), () => .5, null);
  assert.ok(safe);
  assert.equal(safe.planned, false);
  assert.deepEqual(choose(make(hidden), () => .5, null), safe);
  assert.deepEqual(choose(make({ species: 'turtle', count: 100 }), () => .5, null), safe);
});
