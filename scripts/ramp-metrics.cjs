'use strict';

const fs = require('node:fs');
const path = require('node:path');
const base = require('../dist/engine.js');
const baselineEngine = { ...base, createLevel: (level, seed) => base.createLevel(level, seed, 2) };
const { runGame, summarize, POLICY_VERSION } = require('./simulate.cjs');
const { createRampCandidate, configs } = require('./ramp-candidates.cjs');

function emptyBin(lower, upper) {
  return { lower, upper, reached: 0, completed: 0, lost: 0, noProgress: 0, capped: 0, actions: 0, actualActions: 0, cleared: 0, clearSpanCost: 0, terminalNoClearMoves: 0, stores: 0, returns: 0, bufferSum: 0, activeQueueSum: 0, noImmediateClear: 0, legalMoveSum: 0, successesCost: 0, successesCount: 0 };
}

function profileGame(seed, engine, runGameWithPolicy = runGame) {
  const initial = engine.createLevel(2, seed), total = initial.total;
  const threshold = Math.ceil(total * .8 / 5) * 5;
  const game = runGameWithPolicy(seed, { engine, createState: () => structuredClone(initial), threshold, trace: true });
  const limits = Array.from({ length: 11 }, (_, i) => Math.min(total, Math.ceil(total * i / 10 / 5) * 5));
  const bins = Array.from({ length: 10 }, (_, i) => emptyBin(limits[i], limits[i + 1]));
  let state = structuredClone(initial), movesSinceClear = 0;
  for (const move of game.history) {
    const index = Math.max(0, bins.findIndex(bin => state.cleared >= bin.lower && state.cleared < bin.upper));
    const bin = bins[index];
    const legal = engine.legalMoves(state);
    bin.actualActions++;
    bin.bufferSum += state.buffer.length;
    bin.activeQueueSum += state.queues.filter(queue => queue.length).length;
    bin.legalMoveSum += legal.length;
    bin.stores += move.to.type === 'buffer';
    bin.returns += move.from.type === 'buffer';
    if (!legal.some(m => engine.applyMove(state, m.from, m.to).cleared > 0)) bin.noImmediateClear++;
    const result = engine.applyMove(state, move.from, move.to);
    if (!result.ok) throw new Error(`Trace failed replay: ${seed}`);
    movesSinceClear++;
    if (!result.cleared) bin.actions++;
    else {
      for (const target of bins) {
        const share = Math.max(0, Math.min(result.state.cleared, target.upper) - Math.max(state.cleared, target.lower));
        target.cleared += share;
        target.actions += share / result.cleared;
        target.clearSpanCost += movesSinceClear * share / result.cleared;
      }
      movesSinceClear = 0;
    }
    state = result.state;
  }
  for (const bin of bins) {
    bin.reached = game.cleared >= bin.lower ? 1 : 0;
    bin.completed = game.cleared >= bin.upper ? 1 : 0;
    if (bin.completed) { bin.successesCost = bin.actions / ((bin.upper - bin.lower) / 5); bin.successesCount = 1; }
  }
  if (game.outcome !== 'won') {
    const terminal = bins.find(bin => game.cleared >= bin.lower && game.cleared < bin.upper);
    if (terminal) {
      terminal[game.outcome === 'lost' ? 'lost' : game.outcome === 'cap' ? 'capped' : 'noProgress']++;
      terminal.terminalNoClearMoves = movesSinceClear;
    }
  }
  return { ...game, bins };
}

function aggregate(results) {
  const bins = results[0].bins.map(bin => emptyBin(bin.lower, bin.upper));
  for (const result of results) for (let i = 0; i < bins.length; i++) {
    for (const key of Object.keys(bins[i])) if (!['lower', 'upper'].includes(key)) bins[i][key] += result.bins[i][key];
  }
  return bins.map((bin, index) => ({
    progress: `${index * 10}–${(index + 1) * 10}%`, ...bin,
    movesPerFiveIncludingFailed: bin.cleared ? bin.actions / (bin.cleared / 5) : null,
    movesPerFiveAtCompletedClears: bin.cleared ? bin.clearSpanCost / (bin.cleared / 5) : null,
    terminalNoClearMovesPerFailure: (bin.lost + bin.noProgress + bin.capped) ? bin.terminalNoClearMoves / (bin.lost + bin.noProgress + bin.capped) : null,
    meanMovesPerFiveAmongCompleters: bin.successesCount ? bin.successesCost / bin.successesCount : null,
    storeShare: bin.actualActions ? bin.stores / bin.actualActions : null,
    returnShare: bin.actualActions ? bin.returns / bin.actualActions : null,
    meanBufferGroups: bin.actualActions ? bin.bufferSum / bin.actualActions : null,
    meanActiveQueues: bin.actualActions ? bin.activeQueueSum / bin.actualActions : null,
    noImmediateClearShare: bin.actualActions ? bin.noImmediateClear / bin.actualActions : null,
    meanLegalMoves: bin.actualActions ? bin.legalMoveSum / bin.actualActions : null,
    conditionalFailureShare: bin.reached ? (bin.lost + bin.noProgress + bin.capped) / bin.reached : null
  }));
}

function runRampBatch({ engine = baselineEngine, prefix = 'aq-ramp-calibration-v3-20261105', start = 0, count = 100, id = 'production-v2', config = null, policy = null, onProgress } = {}) {
  const started = performance.now(), results = [];
  for (let index = start; index < start + count; index++) {
    results.push({ index, ...profileGame(`${prefix}:${index}`, engine, policy?.runGame || runGame) });
    if (onProgress) onProgress(results.length, count, results.at(-1));
  }
  const threshold = Math.ceil(results[0].total * .8 / 5) * 5;
  return {
    id, config, method: { policy: policy?.POLICY_VERSION || POLICY_VERSION, prefix, start, count, threshold, bins: 'Actual progress, rounded upward to multiples of five; actions crossing a boundary allocated in proportion to clear count.', cost: 'Report completed-clear event spans separately from terminal moves after the last clear, alongside pooled and completer-only costs.', bias: 'Report reached/completed/failed counts per stage and both pooled cost including failure actions and completer-only cost. Later-stage samples contain survivors only.', noRetuneOfPolicy: true },
    elapsedSeconds: (performance.now() - started) / 1000,
    summary: summarize(results, { threshold }), curve: aggregate(results), results
  };
}

if (require.main === module) {
  const count = Number(process.argv[2] || 100);
  const directory = path.resolve(__dirname, 'reports/ramp-v3'); fs.mkdirSync(directory, { recursive: true });
  const all = [{ id: 'production-v2', engine: baselineEngine, config: null }, ...configs.map(config => { const c = createRampCandidate(config); return { id: config.id, ...c }; })];
  for (const candidate of all) {
    const output = path.join(directory, `${candidate.id}-${count}.json`);
    try {
      const report = runRampBatch({ ...candidate, count });
      report.construction = candidate.stats;
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
      const s = report.summary;
      process.stdout.write(JSON.stringify({ id: candidate.id, count, reached80Percent: s.threshold.successes, wins: s.wins.successes, outcomes: s.outcomes, seconds: report.elapsedSeconds, curve: report.curve.map(b => ({ stage: b.progress, reached: b.reached, completed: b.completed, failures: b.lost + b.noProgress + b.capped, stepsPer5: b.movesPerFiveIncludingFailed, completerStepsPer5: b.meanMovesPerFiveAmongCompleters, storeShare: b.storeShare, buffer: b.meanBufferGroups, noClearShare: b.noImmediateClearShare, activeQueues: b.meanActiveQueues })), construction: candidate.stats }) + '\n');
    } catch (error) {
      fs.writeFileSync(output, JSON.stringify({ id: candidate.id, error: error.stack, construction: candidate.stats }, null, 2) + '\n');
      process.stdout.write(JSON.stringify({ id: candidate.id, error: error.message, construction: candidate.stats }) + '\n');
    }
  }
}

module.exports = { profileGame, aggregate, runRampBatch, baselineEngine };
