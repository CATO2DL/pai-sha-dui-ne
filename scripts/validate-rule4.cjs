#!/usr/bin/env node
'use strict';

// Reproduce the frozen rules-four validation. An alternate output directory is
// allowed; seeds, generator and policy stay fixed. Existing reports are never
// overwritten. This is validation only and performs no candidate selection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const engine = require('./fixtures/engine-generator3-rules4.cjs');
const policy = require('./ramp-policy-plan.cjs');
const { runRampBatch } = require('./ramp-metrics.cjs');
const root = path.resolve(__dirname, '..');
const directory = path.resolve(process.argv[2] || path.join(__dirname, 'reports/rule4-cap7'));
const stem = 'fixed-plan-1000';
const prefix = 'aq-rule4-holdout-20261105';
const file = path.join(directory, `${stem}.json`);
const raw = path.join(directory, `${stem}.games.jsonl`);
const started = path.join(directory, `${stem}.started.json`);
for (const output of [file, raw, started]) if (fs.existsSync(output) || fs.existsSync(output + '.gz')) throw new Error(`Refusing to overwrite ${output}`);
if (engine.RULES_VERSION !== 4 || engine.BUFFER_CAPACITY !== 7 || engine.GENERATOR_VERSION !== 3) throw new Error('This validation requires generator three, rules four and seven-animal capacity.');
fs.mkdirSync(directory, { recursive: true });
const files = ['scripts/fixtures/engine-generator3-rules4.cjs', 'scripts/ramp-policy-plan.cjs', 'scripts/simulate.cjs'];
const metadata = {
  startedAt: new Date().toISOString(), rulesVersion: engine.RULES_VERSION,
  bufferCapacityAnimals: engine.BUFFER_CAPACITY, capacityBeforeSettlement: true,
  partialStore: true, generatorVersion: engine.GENERATOR_VERSION,
  policy: policy.POLICY_VERSION, policyUnchangedFromRules3: true,
  prefix, start: 0, count: 1000, threshold: 195, retuning: false,
  hashes: Object.fromEntries(files.map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')]))
};
fs.writeFileSync(started, JSON.stringify(metadata, null, 2) + '\n');
fs.writeFileSync(raw, '');
let checkedLiveTransitions = 0, maxBufferAnimals = 0;
const checked = {
  ...engine,
  applyMove(state, from, to) {
    const result = engine.applyMove(state, from, to);
    if (result.ok) {
      const count = result.state.buffer.reduce((sum, group) => sum + group.count, 0);
      maxBufferAnimals = Math.max(maxBufferAnimals, count);
      if (count > 7) throw new Error('Buffer capacity violated.');
      // Policy observations omit generatorVersion and use anonymous tails;
      // conservation can only be checked on complete game states.
      if (state.generatorVersion !== undefined) {
        checkedLiveTransitions++;
        if (engine.remaining(result.state) + result.state.cleared !== result.state.total) throw new Error('Animal conservation violated.');
      }
    }
    return result;
  }
};
const result = runRampBatch({
  engine: checked, policy, prefix, count: 1000, id: 'generator3-rules4-cap7-fixed-policy',
  onProgress(done, total, game) {
    fs.appendFileSync(raw, JSON.stringify(game) + '\n');
    if (done % 100 === 0) process.stdout.write(`Completed ${done}/${total}\n`);
  }
});
result.method = { ...result.method, ...metadata };
result.validation = { checkedLiveTransitions, maxBufferAnimals };
fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(JSON.stringify({ file, threshold: result.summary.threshold, wins: result.summary.wins, outcomes: result.summary.outcomes, elapsedSeconds: result.elapsedSeconds, validation: result.validation }) + '\n');
