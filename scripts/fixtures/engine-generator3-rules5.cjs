(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimalQueueEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const species = Object.freeze(['sheep', 'dog', 'cat', 'duck', 'pig', 'rabbit', 'cow', 'frog', 'panda', 'raccoon', 'capybara', 'elephant', 'penguin', 'chicken', 'fox', 'turtle']);
  const MATCH_COUNT = 5;
  const BUFFER_CAPACITY = 7;
  const BUFFER_SLOTS = BUFFER_CAPACITY;
  const LEGACY_BUFFER_GROUPS = 4;
  const RULES_VERSION = 5;
  const GENERATOR_VERSION = 3;
  // Origins are reconstructed from history, never exposed or serialized.
  const bufferOrigins = new WeakMap();
  const copyGroup = group => {
    const copy = { species: group.species, count: group.count };
    if (bufferOrigins.has(group)) bufferOrigins.set(copy, bufferOrigins.get(group));
    return copy;
  };
  const copyState = state => ({ ...state, queues: state.queues.map(queue => queue.map(copyGroup)), buffer: state.buffer.map(copyGroup) });
  const sumQueue = queue => queue.reduce((sum, group) => sum + group.count, 0);
  const remaining = state => state.queues.reduce((sum, queue) => sum + sumQueue(queue), sumQueue(state.buffer));

  function getHead(state, source) {
    if (!source || !state) return null;
    if (source.type === 'buffer' && (source.index === undefined || source.index === 0)) return state.buffer[0] || null;
    if (source.type === 'queue' && Number.isInteger(source.index)) return state.queues[source.index]?.[0] || null;
    return null;
  }

  function mergeAdjacent(queue) {
    const result = [];
    for (const group of queue) {
      if (result.length && result[result.length - 1].species === group.species) result[result.length - 1].count += group.count;
      else result.push(copyGroup(group));
    }
    return result;
  }

  // Main queues coalesce. Buffer groups intentionally keep their insertion boundaries.
  function settle(state, replayLegacy = false) {
    let cleared = 0;
    state.queues = state.queues.map(mergeAdjacent);
    for (const queue of state.queues) {
      while (queue[0]?.count >= MATCH_COUNT) {
        const count = Math.floor(queue[0].count / MATCH_COUNT) * MATCH_COUNT;
        cleared += count;
        queue[0].count -= count;
        if (queue[0].count === 0) queue.shift();
      }
    }
    if (replayLegacy) while (state.buffer.length) {
      const type = state.buffer[0].species;
      let count = 0;
      for (const group of state.buffer) {
        if (group.species !== type) break;
        count += group.count;
      }
      let remove = Math.floor(count / MATCH_COUNT) * MATCH_COUNT;
      if (!remove) break;
      cleared += remove;
      while (remove) {
        const used = Math.min(remove, state.buffer[0].count);
        state.buffer[0].count -= used;
        remove -= used;
        if (!state.buffer[0].count) state.buffer.shift();
      }
    }
    else {
      const totals = new Map();
      for (const group of state.buffer) totals.set(group.species, (totals.get(group.species) || 0) + group.count);
      const pending = new Map([...totals].map(([type, count]) => [type, Math.floor(count / MATCH_COUNT) * MATCH_COUNT]));
      // Consume the oldest matching groups, without coalescing surviving boundaries.
      state.buffer = state.buffer.filter(group => {
        const used = Math.min(group.count, pending.get(group.species));
        group.count -= used;
        pending.set(group.species, pending.get(group.species) - used);
        cleared += used;
        return group.count > 0;
      });
    }
    state.cleared = (state.cleared || 0) + cleared;
    return cleared;
  }

  function transfer(state, from, to, rulesVersion = RULES_VERSION) {
    const replayLegacy = rulesVersion < 3;
    const group = getHead(state, from);
    if (!group) return { ok: false, error: '这里只能选择队首的一整组动物。' };
    if (!to || !['queue', 'buffer'].includes(to.type)) return { ok: false, error: '请选择一个目的地。' };
    if (from.type === 'buffer' && to.type === 'buffer') return { ok: false, error: '暂存队首只能移回同类主队。' };
    if (to.type === 'queue') {
      if (from.type === 'queue' && from.index === to.index) return { ok: false, error: '这组动物已经在这条队伍中。' };
      const destination = getHead(state, to);
      if (!destination) return { ok: false, error: '这条队伍已清空，不能再放入动物。' };
      if (group.species !== destination.species) return { ok: false, error: '只能移到同种动物的队首。' };
      if (!replayLegacy && from.type === 'queue' && group.count + destination.count < MATCH_COUNT) return { ok: false, error: '主队之间只有凑够五只才能直接消除。' };
    }
    let amount = group.count;
    if (rulesVersion >= 4 && to.type === 'buffer') {
      const free = Math.max(0, BUFFER_CAPACITY - sumQueue(state.buffer));
      amount = Math.min(group.count, free);
      if (rulesVersion >= 5) {
        const matching = state.buffer.reduce((sum, stored) => sum + (stored.species === group.species ? stored.count : 0), 0);
        const needed = MATCH_COUNT - matching;
        // An immediate clear may bypass occupied slots. Take only what this
        // match needs; do not use the newly freed slots to draw extra animals.
        if (needed > amount && needed <= group.count) amount = needed;
      }
      if (amount <= 0) return { ok: false, error: rulesVersion >= 5 ? '暂存已满，只有能直接凑够五只的同类才能移入。' : '暂存已满，最多只能放七只动物。' };
    }
    const next = copyState(state);
    let moved;
    if (from.type === 'queue' && to.type === 'buffer' && amount < group.count) {
      moved = copyGroup(next.queues[from.index][0]);
      moved.count = amount;
      next.queues[from.index][0].count -= amount;
    } else moved = from.type === 'queue' ? next.queues[from.index].shift() : next.buffer.shift();
    if (to.type === 'buffer') {
      bufferOrigins.set(moved, from.index);
      next.buffer.push(moved);
    }
    else next.queues[to.index].unshift(moved);
    const cleared = settle(next, replayLegacy);
    if (rulesVersion < 4 && next.buffer.length > LEGACY_BUFFER_GROUPS) return { ok: false, error: '暂存已满：消除后也只能保留四组。' };
    next.moves = (state.moves || 0) + 1;
    return { ok: true, state: next, cleared };
  }

  function enumerateMoves(state) {
    const result = [];
    const sources = state.queues.flatMap((queue, index) => queue.length ? [{ type: 'queue', index }] : []);
    if (state.buffer.length) sources.push({ type: 'buffer' });
    for (const from of sources) {
      for (let index = 0; index < state.queues.length; index++) {
        const to = { type: 'queue', index };
        if (transfer(state, from, to).ok) result.push({ from, to });
      }
      if (from.type === 'queue' && transfer(state, from, { type: 'buffer' }).ok) result.push({ from, to: { type: 'buffer' } });
    }
    return result;
  }

  function legalMoves(state) {
    if (state.status !== 'playing') return [];
    return enumerateMoves(state);
  }

  function applyMove(state, from, to) {
    if (state.status !== 'playing') return { ok: false, state, cleared: 0, error: '本局已结束，请重新开始。' };
    const result = transfer(state, from, to);
    if (!result.ok) return { ...result, state, cleared: 0 };
    result.state.status = remaining(result.state) === 0 ? 'won' : enumerateMoves(result.state).length ? 'playing' : 'lost';
    return result;
  }

  function migrateBufferCapacity(state) {
    let free = BUFFER_CAPACITY;
    const retained = [], returned = [];
    for (const group of state.buffer) {
      const keep = Math.min(free, group.count);
      free -= keep;
      if (keep) {
        const part = copyGroup(group); part.count = keep; retained.push(part);
      }
      if (keep < group.count) {
        const origin = bufferOrigins.get(group);
        if (!Number.isInteger(origin) || !state.queues[origin]) throw new Error('无法确定旧暂存动物的来源，存档未修改。');
        const part = copyGroup(group); part.count -= keep;
        returned.push({ group: part, origin });
      }
    }
    state.buffer = retained;
    // Reverse insertion restores the original FIFO order within each source.
    // Reopening a closed source is permitted only for this one-time migration.
    for (let index = returned.length - 1; index >= 0; index--) {
      const { group, origin } = returned[index];
      state.queues[origin].unshift(group);
    }
    settle(state);
  }

  // Replay each historical rule exactly, then migrate once at the first v4+
  // move (or after an entirely old save). Origins survive global consumption,
  // so nonadjacent matches and partially consumed groups migrate losslessly.
  function restoreReplay(level, seed, history, generatorVersion = 1) {
    if (!Array.isArray(history)) throw new TypeError('存档移动记录必须是数组。');
    let state = createLevel(level, seed, generatorVersion);
    let phase = 2;
    for (let index = 0; index < history.length; index++) {
      const move = history[index];
      if (!move || typeof move !== 'object') throw new Error(`存档第 ${index + 1} 步无效。`);
      const version = move.rulesVersion === undefined ? 2 : move.rulesVersion;
      if (![1, 2, 3, 4, 5].includes(version)) throw new Error(`存档第 ${index + 1} 步规则版本无效。`);
      const nextPhase = Math.max(2, version);
      if (nextPhase < phase) throw new Error(`存档第 ${index + 1} 步不能退回旧规则。`);
      if (phase < 3 && nextPhase >= 3) settle(state);
      if (phase < 4 && nextPhase >= 4) migrateBufferCapacity(state);
      phase = nextPhase;
      if (remaining(state) === 0) throw new Error(`存档第 ${index + 1} 步无效。`);
      const result = transfer(state, move.from, move.to, version);
      if (!result.ok) throw new Error(`存档第 ${index + 1} 步无效：${result.error}`);
      state = result.state;
    }
    if (phase < 3) settle(state);
    if (phase < 4) migrateBufferCapacity(state);
    state.status = remaining(state) === 0 ? 'won' : enumerateMoves(state).length ? 'playing' : 'lost';
    return state;
  }

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

  function shuffle(items, random) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeTail(selected, random) {
    // Retry adjacency construction only, never test or filter puzzle solvability.
    for (let attempt = 0; attempt < 100; attempt++) {
      const queues = [[], [], []];
      const inventory = new Map(selected.map(type => [type, 5]));
      let pending = 40;
      while (pending) {
        const choices = [];
        for (const type of selected) {
          if (!inventory.get(type)) continue;
          for (let lane = 0; lane < 3; lane++) {
            if (queues[lane].at(-1)?.species !== type) choices.push({ type, lane });
          }
        }
        if (!choices.length) break;
        const choice = choices[Math.floor(random() * choices.length)];
        const available = inventory.get(choice.type);
        const weights = [7, 4, 1].slice(0, Math.min(3, available));
        let draw = random() * weights.reduce((a, b) => a + b, 0);
        let count = 1;
        while (count < weights.length && draw >= weights[count - 1]) draw -= weights[count++ - 1];
        queues[choice.lane].push({ species: choice.type, count });
        inventory.set(choice.type, available - count);
        pending -= count;
      }
      if (!pending) return queues;
    }
    // A finite adjacency-safe fallback preserves every species quota.
    const queues = [[], [], []];
    const order = shuffle(selected, random);
    for (let pass = 0; pass < 5; pass++) order.forEach((type, index) => queues[(index + pass) % 3].push({ species: type, count: 1 }));
    return queues.map(mergeAdjacent);
  }

  function addPhase(queues, pending, random, phase) {
    while (pending.length) {
      const possible = shuffle(pending.map((type, index) => ({ type, index })), random).filter(({ type }) => queues.filter(queue => queue[0]?.species !== type).length >= (phase === 'middle' ? 3 : 2));
      if (!possible.length) return false;
      const { type, index } = possible[0];
      const split = phase === 'middle' ? (random() < 0.5 ? [2, 2, 1] : [3, 1, 1]) : (random() < 0.8 ? [2, 3] : [1, 4]);
      const eligible = queues.map((queue, lane) => ({ lane, length: sumQueue(queue), tie: random() })).filter(({ lane }) => queues[lane][0]?.species !== type).sort((a, b) => a.length - b.length || a.tie - b.tie).slice(0, split.length);
      shuffle(split, random).forEach((count, offset) => queues[eligible[offset].lane].unshift({ species: type, count }));
      pending.splice(index, 1);
    }
    return true;
  }

  function makeChallenge(random) {
    const selected = shuffle(species, random).slice(0, 8);
    for (let attempt = 0; attempt < 100; attempt++) {
      const queues = [...makeTail(selected, random), [], []];
      if (!addPhase(queues, [...selected], random, 'middle')) continue;
      if (!addPhase(queues, [...selected, ...selected], random, 'early')) continue;
      return shuffle(queues, random);
    }
    // This cannot occur with normal seeds: the finite retry prevents a stuck page.
    throw new Error('盘面生成失败，请更换随机种子。');
  }

  // Generator two: 130 animals in paired opening groups, then six species with
  // five each in two fragmented tail queues. Retry layout construction only;
  // never run a solver, filter outcomes, or alter a board while it is played.
  function makeLateTail(selected, random) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const queues = [[], []];
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
        const weights = [30, 2, 1].slice(0, Math.min(3, inventory.get(type)));
        let draw = random() * weights.reduce((a, b) => a + b, 0), count = 1;
        while (count < weights.length && draw >= weights[count - 1]) draw -= weights[count++ - 1];
        queues[lane].push({ species: type, count });
        inventory.set(type, inventory.get(type) - count);
        pending -= count;
      }
      if (!pending) return queues;
    }
    throw new Error('尾段排列生成失败，请更换随机种子。');
  }

  function addOpeningPhase(queues, selected, random) {
    const pending = [...selected, ...selected, ...selected, ...selected.slice(6)];
    while (pending.length) {
      const heads = new Set(queues.filter(queue => queue.length).map(queue => queue[0].species));
      const eligible = shuffle(pending.map((type, index) => ({ type, index })), random).filter(({ type }) => !heads.has(type));
      if (!eligible.length) return false;
      const { type, index } = eligible[0];
      const pairs = [];
      for (let first = 0; first < 5; first++) for (let second = first + 1; second < 5; second++) {
        pairs.push({ lanes: [first, second], length: sumQueue(queues[first]) + sumQueue(queues[second]), tie: random() });
      }
      pairs.sort((a, b) => a.length - b.length || a.tie - b.tie);
      const pair = pairs[0].lanes;
      const split = shuffle(random() < .8 ? [2, 3] : [1, 4], random);
      pair.forEach((lane, offset) => queues[lane].unshift({ species: type, count: split[offset] }));
      pending.splice(index, 1);
    }
    return true;
  }

  function makeChallengeV2(random) {
    const selected = shuffle(species, random).slice(0, 8);
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const queues = makeLateTail(selected.slice(0, 6), random);
      while (queues.length < 5) queues.push([]);
      if (!addOpeningPhase(queues, selected, random)) continue;
      return shuffle(queues, random);
    }
    throw new Error('盘面生成失败，请更换随机种子。');
  }

  // Version three lengthens the round and gradually shifts five-animal packs
  // from two groups to three/four groups. Every layout is fixed before play.
  const RAMP_CONFIG = Object.freeze({ tailLanes: 4, tailWeights: [16, 3, 1], easyFraction: .12, rampExponent: 1.6, quartetMax: .45 });
  function rampLaneChoices(size) {
    const choices = [];
    function visit(next, chosen) {
      if (chosen.length === size) { choices.push(chosen); return; }
      for (let lane = next; lane < 6; lane++) visit(lane + 1, [...chosen, lane]);
    }
    visit(0, []);
    return choices;
  }
  function makeRampTail(selected, random) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const queues = Array.from({ length: RAMP_CONFIG.tailLanes }, () => []);
      const stock = new Map(selected.map((type, index) => [type, index === 0 ? 10 : 5]));
      let pending = 45;
      while (pending) {
        const choices = [];
        for (const type of selected) if (stock.get(type)) {
          for (let lane = 0; lane < queues.length; lane++) if (queues[lane].at(-1)?.species !== type) choices.push({ type, lane });
        }
        if (!choices.length) break;
        const { type, lane } = choices[Math.floor(random() * choices.length)];
        const weights = RAMP_CONFIG.tailWeights.slice(0, Math.min(3, stock.get(type)));
        let draw = random() * weights.reduce((a, b) => a + b, 0), count = 1;
        while (count < weights.length && draw >= weights[count - 1]) draw -= weights[count++ - 1];
        queues[lane].push({ species: type, count });
        stock.set(type, stock.get(type) - count); pending -= count;
      }
      if (!pending) return queues;
    }
    throw new Error('尾段排列生成失败，请更换随机种子。');
  }
  function rampSplit(progress, random) {
    const t = Math.max(0, Math.min(1, (progress - RAMP_CONFIG.easyFraction) / (1 - RAMP_CONFIG.easyFraction)));
    const pair = Math.pow(1 - t, RAMP_CONFIG.rampExponent), quartet = RAMP_CONFIG.quartetMax * t * t;
    const draw = random();
    if (draw < pair) return random() < .8 ? [2, 3] : [1, 4];
    if (draw < pair + quartet) return [2, 1, 1, 1];
    return random() < .5 ? [2, 2, 1] : [3, 1, 1];
  }
  function makeChallengeV3(random) {
    const selected = shuffle(species, random).slice(0, 8);
    for (let attempt = 0; attempt < 1000; attempt++) {
      const queues = makeRampTail(selected, random);
      while (queues.length < 6) queues.push([]);
      const stock = new Map(selected.map((type, index) => [type, index === 0 ? 4 : 5]));
      let previousLanes = queues.flatMap((queue, lane) => queue.length ? [lane] : []), failed = false;
      for (let forwardIndex = 38; forwardIndex >= 0; forwardIndex--) {
        const heads = new Set(queues.filter(queue => queue.length).map(queue => queue[0].species));
        const eligible = selected.flatMap(type => !heads.has(type) ? Array(stock.get(type)).fill(type) : []);
        if (!eligible.length) { failed = true; break; }
        const type = eligible[Math.floor(random() * eligible.length)];
        const split = shuffle(rampSplit(forwardIndex / 38, random), random);
        const required = Math.min(split.length, Math.max(1, previousLanes.length - 1));
        const choices = rampLaneChoices(split.length)
          .filter(lanes => lanes.filter(lane => previousLanes.includes(lane)).length >= required)
          .map(lanes => ({ lanes, length: lanes.reduce((sum, lane) => sum + sumQueue(queues[lane]), 0), tie: random() }));
        choices.sort((a, b) => a.length - b.length || a.tie - b.tie);
        const lanes = choices[0].lanes;
        split.forEach((count, offset) => queues[lanes[offset]].unshift({ species: type, count }));
        previousLanes = lanes;
        stock.set(type, stock.get(type) - 1);
      }
      if (!failed) return shuffle(queues, random);
    }
    throw new Error('盘面生成失败，请更换随机种子。');
  }

  function createLevel(level, seed, generatorVersion = GENERATOR_VERSION) {
    if (level !== 1 && level !== 2) throw new RangeError('关卡只能是 1 或 2。');
    if (![1, 2, 3].includes(generatorVersion)) throw new RangeError('未知的盘面生成版本。');
    const fixedSeed = String(seed ?? Math.floor(Math.random() * 1000000000));
    const queues = level === 1 ? [
      [{ species: 'sheep', count: 2 }, { species: 'cat', count: 3 }],
      [{ species: 'sheep', count: 3 }, { species: 'dog', count: 2 }],
      [{ species: 'cat', count: 2 }, { species: 'dog', count: 3 }]
    ] : ({ 1: makeChallenge, 2: makeChallengeV2, 3: makeChallengeV3 })[generatorVersion](seededRandom(fixedSeed));
    return { level, seed: fixedSeed, generatorVersion: level === 1 ? 1 : generatorVersion, queues, buffer: [], total: level === 1 ? 15 : generatorVersion === 3 ? 240 : 160, cleared: 0, moves: 0, status: 'playing' };
  }

  // A local suggestion, not a solver: hidden tails are never inspected for hints.
  function getHint(state) {
    const moves = legalMoves(state);
    if (!moves.length) return null;
    return moves.map(move => {
      const result = transfer(state, move.from, move.to);
      let score = result.cleared * 100;
      if (move.from.type === 'buffer') score += 45;
      if (move.to.type === 'queue') score += 30;
      if (move.to.type === 'buffer') {
        score -= result.state.buffer.length * 10;
        const nextHead = state.queues[move.from.index][1];
        if (nextHead && state.queues.some((queue, index) => index !== move.from.index && queue[0]?.species === nextHead.species)) score += 20;
      }
      return { move, score };
    }).sort((a, b) => b.score - a.score)[0].move;
  }

  return Object.freeze({ species, MATCH_COUNT, BUFFER_CAPACITY, BUFFER_SLOTS, RULES_VERSION, GENERATOR_VERSION, createLevel, getHead, legalMoves, applyMove, restoreReplay, getHint, remaining });
});
