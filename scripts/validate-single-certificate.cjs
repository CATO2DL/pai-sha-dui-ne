#!/usr/bin/env node
'use strict';

// node scripts/validate-single-certificate.cjs --seeds 1000 --out /tmp/certificate.json
// No output path prints JSON. An existing output file is never overwritten.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILES = ['dist/engine.js', 'dist/generator.js'];
const TOTALS = [60, 100, 150, 210, 280];
const SEED_PREFIX = 'aq-independent-certificate-20261105';

function sourceHashes() {
  return Object.fromEntries(SOURCE_FILES.map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
}

// Kept independent of the engine implementation to check seed integration.
function seededRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return function () {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function timingSummary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = value => Number(value.toFixed(6));
  return {
    samples: sorted.length,
    min_ms: round(sorted[0]),
    median_ms: round(sorted[Math.floor(sorted.length * .5)]),
    p95_ms: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]),
    max_ms: round(sorted.at(-1))
  };
}

function validateCertificates({ seedsPerLevel = 1000, seedPrefix = SEED_PREFIX } = {}) {
  if (!Number.isSafeInteger(seedsPerLevel) || seedsPerLevel < 1) throw new Error('seedsPerLevel must be a positive integer.');
  const hashes = sourceHashes();
  const E = require('../dist/engine.js');
  const G = require('../dist/generator.js');
  assert.equal(E.RULES_VERSION, 6);
  assert.equal(E.GENERATOR_VERSION, 4);
  assert.deepEqual(sourceHashes(), hashes);
  const startedAt = new Date().toISOString(), started = performance.now();
  const sum = queue => queue.reduce((total, group) => total + group.count, 0);
  const perLevel = [], allTimings = [];
  let actions = 0, rescues = 0;

  for (let level = 1; level <= 5; level++) {
    const row = {
      level, seeds: seedsPerLevel, total: TOTALS[level - 1], lanes: level + 2,
      wins: 0, max_buffer: 0, earliest_closed_fraction: 1,
      first80_carry_sum: 0, first80_stages: 0, last20_carry_sum: 0, last20_stages: 0,
      preview_stages: 0
    };
    const timings = [];
    for (let seedIndex = 0; seedIndex < seedsPerLevel; seedIndex++) {
      const seed = `${seedPrefix}:${level}:${seedIndex}`;
      const random = seededRandom(seed);
      const beforeBuild = performance.now();
      const built = G.build(E.species, random, level);
      timings.push(performance.now() - beforeBuild);
      let state = E.createLevel(level, seed, 4);
      assert.deepEqual(state.queues, built.queues, `${seed}: engine/generator mismatch`);
      assert.equal(state.total, row.total);
      assert.equal(state.generatorVersion, 4);
      assert.equal(built.solution.length, state.total);
      assert.equal(state.queues.length, row.lanes);
      const certificateQueues = built.queues.map(queue => queue.flatMap(group => Array(group.count).fill(group.species)));
      const quota = {};
      for (const queue of state.queues) {
        assert(queue.length > 0);
        queue.forEach((group, index) => {
          assert(group.count >= 1 && group.count <= 4);
          assert.notEqual(group.species, queue[index + 1]?.species);
          quota[group.species] = (quota[group.species] || 0) + group.count;
        });
      }
      assert.equal(Object.keys(quota).length, level + 3);
      Object.values(quota).forEach(count => assert.equal(count, (level + 2) * 5));
      // Stage metadata is descriptive only: the certificate is validated from
      // the actual initial queues and lane sequence, with no assumed pattern.
      built.stages.forEach(stage => {
        if (stage.preview) row.preview_stages++;
        if (stage.start / state.total >= .8) {
          row.last20_carry_sum += stage.carry;
          row.last20_stages++;
        } else {
          row.first80_carry_sum += stage.carry;
          row.first80_stages++;
        }
      });

      for (let index = 0; index < built.solution.length; index++) {
        const lane = built.solution[index];
        assert(Number.isInteger(lane) && lane >= 0 && lane < row.lanes, `${seed}: invalid certificate lane at ${index}`);
        const expected = certificateQueues[lane].shift();
        assert.notEqual(expected, undefined, `${seed}: exhausted certificate lane at ${index}`);
        assert.equal(state.queues[lane][0]?.species, expected, `${seed}: certificate ordering at ${index}`);
        const queueLengths = state.queues.map(sum), bufferBefore = sum(state.buffer);
        const matching = state.buffer.filter(group => group.species === expected).reduce((n, group) => n + group.count, 0);
        const clearedBefore = state.cleared;
        const result = E.applyMove(state, { type: 'queue', index: lane }, { type: 'buffer' });
        assert(result.ok, `${seed}: action ${index}: ${result.error}`);
        state = result.state;
        assert.equal(result.cleared, matching === 4 ? 5 : 0);
        assert.equal(state.cleared - clearedBefore, result.cleared);
        state.queues.forEach((queue, other) => {
          assert.equal(sum(queue), queueLengths[other] - (other === lane ? 1 : 0), `${seed}: unintended main clear at ${index}`);
        });
        const used = sum(state.buffer);
        assert(used <= E.BUFFER_CAPACITY);
        row.max_buffer = Math.max(row.max_buffer, used);
        if (bufferBefore === 7) {
          assert.equal(matching, 4);
          assert.equal(result.cleared, 5);
          rescues++;
        }
        if (state.queues.some(queue => queue.length === 0)) {
          row.earliest_closed_fraction = Math.min(row.earliest_closed_fraction, (index + 1) / state.total);
        }
        assert.equal(E.remaining(state) + state.cleared, state.total);
        assert.equal(state.status, index === built.solution.length - 1 ? 'won' : 'playing');
        actions++;
      }
      assert.equal(state.cleared, row.total);
      assert.equal(state.moves, row.total);
      assert.equal(state.buffer.length, 0);
      assert(state.queues.every(queue => queue.length === 0));
      assert(certificateQueues.every(queue => queue.length === 0));
      row.wins++;
    }
    row.mean_carry_first80 = Number((row.first80_carry_sum / row.first80_stages).toFixed(3));
    row.mean_carry_last20 = Number((row.last20_carry_sum / row.last20_stages).toFixed(3));
    row.earliest_closed_fraction = Number(row.earliest_closed_fraction.toFixed(4));
    row.construction_timing = timingSummary(timings);
    allTimings.push(...timings);
    perLevel.push(row);
  }
  assert.deepEqual(sourceHashes(), hashes, 'Source changed while validation was running.');
  return {
    schema_version: 1, result: 'PASS', rules_version: 6, generator_version: 4,
    method: 'Independently expand the initial queues to individual animals, consume the lane sequence in each construction certificate, and execute each action through the production single-animal engine. Check exact species sequence, unit removal, no main-queue auto-clear, quotas, capacity, conservation and final win. Stage metadata is descriptive and is not used to determine actions or expected species.',
    seed_prefix: seedPrefix, seed_pattern: '<prefix>:<level>:<index>', seed_index_range: [0, seedsPerLevel - 1],
    source_sha256: hashes, started_at_utc: startedAt, completed_at_utc: new Date().toISOString(),
    certificate_run_ms: Number((performance.now() - started).toFixed(3)),
    boards: seedsPerLevel * 5, actions, full_buffer_single_clear_rescues: rescues,
    wins: perLevel.reduce((total, row) => total + row.wins, 0),
    construction_failures: 0, illegal_certificate_actions: 0, unintended_main_clears: 0,
    capacity_violations: 0, conservation_failures: 0,
    construction_timing: timingSummary(allTimings), per_level: perLevel,
    construction_timing_method: 'Measure only G.build with performance.now(), excluding random initialization, engine createLevel and certificate replay. No explicit warm-up. Percentiles use sorted sample indices floor(n * .5) and min(n - 1, floor(n * .95)).',
    runtime: { node: process.version, platform: process.platform, architecture: process.arch },
    carry_window_definition: 'First80 contains stages whose start / total < 0.8; Last20 contains stages whose start / total >= 0.8. Variable stage length means the latter need not contain exactly 20% of actions.',
    limitation: 'This verifies known legal routes from the starting boards, not human win rate or solvability after arbitrary choices. Timing is local construction performance, not mobile rendering performance.'
  };
}

if (require.main === module) {
  let seedsPerLevel = 1000, seedPrefix = SEED_PREFIX, output;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--seeds') seedsPerLevel = Number(args[++index]);
    else if (args[index] === '--prefix') seedPrefix = args[++index];
    else if (args[index] === '--out') output = args[++index];
    else throw new Error(`Unknown argument: ${args[index]}`);
  }
  if (output && fs.existsSync(output)) throw new Error('Output already exists; choose a new filename.');
  const report = validateCertificates({ seedsPerLevel, seedPrefix });
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) fs.writeFileSync(output, json, { flag: 'wx' });
  else process.stdout.write(json);
}

module.exports = { seededRandom, sourceHashes, timingSummary, validateCertificates };
