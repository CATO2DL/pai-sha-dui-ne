/* Fixed, seeded levels made from overlapping five-animal pairs.
 * The construction order is a legal single-animal solution, never a live hint.
 * There is no separately randomized tail and no board changes during play. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AnimalQueueGenerator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LEVELS = Object.freeze([
    { lanes: 3, types: 4, packs: 3, carry: [0, .4], spread: [2, 2] },
    { lanes: 4, types: 5, packs: 4, carry: [.35, .8], spread: [2, 3] },
    { lanes: 5, types: 6, packs: 5, carry: [.75, 1.25], spread: [3, 3] },
    { lanes: 6, types: 7, packs: 6, carry: [1.1, 1.65], spread: [3, 4] },
    { lanes: 7, types: 8, packs: 7, carry: [1.4, 1.9], spread: [4, 5] }
  ].map(level => Object.freeze({ ...level, carry: Object.freeze(level.carry), spread: Object.freeze(level.spread) })));

  function shuffle(items, random) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function build(species, random, level = 2) {
    const config = LEVELS[level - 1];
    if (!config) throw new RangeError('Unknown level.');
    const selected = shuffle(species, random).slice(0, config.types);
    const packets = [];
    for (let cycle = 0; cycle < config.packs; cycle++) {
      const order = shuffle(selected, random);
      if (order[0] === packets.at(-1)) [order[0], order[1]] = [order[1], order[0]];
      packets.push(...order);
    }
    const queues = Array.from({ length: config.lanes }, () => []);
    const solution = [], stages = [];
    const lengths = Array(config.lanes).fill(0);
    const rounds = packets.length / 2;
    let carried = null;
    const allLanes = Array.from({ length: config.lanes }, (_, lane) => lane);

    for (let round = 0; round < rounds; round++) {
      const progress = round / Math.max(1, rounds - 1);
      const [first, second] = packets.slice(round * 2, round * 2 + 2);
      const firstCount = 5 - (carried === first ? 1 : 0);
      // The final level occasionally previews one animal from the next pair.
      // It is completed in that next pair, never scattered into a random tail.
      const preview = level === 5 && round % 2 === 0 && random() < .35 + .3 * progress
        ? packets[round * 2 + 2] : null;
      const pressure = config.carry[0] + (config.carry[1] - config.carry[0]) * progress;
      const carry = Math.min(2, Math.floor(pressure + random()));
      const spread = Math.min(firstCount, config.lanes, Math.max(2,
        Math.round(config.spread[0] + (config.spread[1] - config.spread[0]) * progress),
        config.lanes + carry - 4));
      let placed = false;
      for (let attempt = 0; attempt < 80 && !placed; attempt++) {
        const draft = queues.map(queue => queue.map(group => ({ ...group })));
        const events = [], touches = new Set();
        const append = (lane, type) => {
          const tail = draft[lane].at(-1);
          if (tail?.species === type && tail.count >= 4) return false;
          if (tail?.species === type) tail.count++;
          else draft[lane].push({ species: type, count: 1 });
          events.push({ lane, species: type }); touches.add(lane);
          return true;
        };
        const lanes = shuffle(allLanes, random);
        const firstLanes = lanes.slice(0, spread);
        let valid = true;
        for (const lane of firstLanes.slice(0, carry)) if (!append(lane, second)) { valid = false; break; }
        if (valid && preview && !append(firstLanes[carry % spread], preview)) valid = false;
        if (!valid) continue;
        const counts = Array(spread).fill(1);
        for (let extra = spread; extra < firstCount; extra++) {
          const minimum = Math.min(...counts);
          const options = counts.flatMap((count, index) => count === minimum ? [index] : []);
          counts[options[Math.floor(random() * options.length)]]++;
        }
        for (const index of shuffle(Array.from({ length: spread }, (_, i) => i), random)) {
          for (let n = 0; n < counts[index]; n++) if (!append(firstLanes[index], first)) { valid = false; break; }
          if (!valid) break;
        }
        if (!valid) continue;
        let remaining = 5 - carry;
        // Every pair touches every lane, keeping future species from forming a
        // whole unrelated random endgame. Only a few near-future heads appear.
        for (const lane of lanes.slice(spread)) {
          if (!append(lane, second)) { valid = false; break; }
          remaining--;
        }
        if (!valid || remaining < 0) continue;
        // Keep one partner behind a first-species animal. Otherwise a large
        // spread can accidentally put all five partners at the front and
        // make later rounds easier than earlier ones.
        if (carry > 0 && remaining > 0) {
          if (!append(firstLanes[Math.floor(random() * firstLanes.length)], second)) continue;
          remaining--;
        }
        while (remaining--) {
          const options = shuffle(allLanes, random).filter(lane => {
            const tail = draft[lane].at(-1);
            return tail?.species !== second || tail.count < 3;
          }).sort((a, b) => lengths[a] + events.filter(e => e.lane === a).length
            - lengths[b] - events.filter(e => e.lane === b).length);
          if (!options.length || !append(options[0], second)) { valid = false; break; }
        }
        if (!valid || touches.size !== config.lanes) continue;
        draft.forEach((queue, lane) => { queues[lane] = queue; });
        events.forEach(event => { solution.push(event.lane); lengths[event.lane]++; });
        stages.push({ first, second, carry, spread, pressure, preview, held: carried,
          start: solution.length - events.length, end: solution.length });
        carried = preview;
        placed = true;
      }
      if (!placed) throw new Error('Level construction failed.');
    }
    return { queues, solution, stages, selected, level, total: solution.length };
  }

  function generate(species, random, level = 2) { return build(species, random, level).queues; }
  return Object.freeze({ generate, build, LEVELS });
});
