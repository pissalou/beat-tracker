/**
 * Transcribe tapped timestamps into beat durations + tempo.
 *
 * 1. Turn timestamps into inter-onset intervals (IOIs).
 * 2. Generate candidate (tempo, subdivision) pairs by assuming each IOI
 *    spans a whole number of grid units.
 * 3. Quantize every IOI to that grid and measure the timing error.
 * 4. Score each candidate on fit error + tempo plausibility + subdivision
 *    simplicity, and return the cheapest one.
 */

// Cost of each subdivision of the beat (lower = more common/simpler).
const SUBDIVISION_COST = { 2: 0.0, 4: 0.1, 3: 0.3, 8: 0.4, 6: 0.5 };

function transcribe(tapsMs, {
  bpmRange = [60, 240], // plausible tempo range in BPM
  preferredBpm = 120, // tempo to tend toward (penalty cost evaluated on a log scale)
  wError = 10.0, // weight of timing error in the cost function
  wTempo = 1.0, // weight of tempo plausibility in the cost function
  beatsPerBar = 4,
  firstTapBeat = null, // force the first tap's position in the bar (in beats, 0-based)
} = {}) {
  const iois = tapsMs.slice(1).map((t, i) => t - tapsMs[i]);
  if (iois.length === 0) throw new Error("need at least two taps");

  const quantize = (unit) => iois.map((i) => Math.max(1, Math.round(i / unit)));

  let best = null;
  for (const [subdivKey, subdivCost] of Object.entries(SUBDIVISION_COST)) {
    const subdiv = Number(subdivKey);
    for (const ioi of iois) {
      // Hypothesis: this IOI is n grid units long.
      for (let n = 1; n <= 4 * subdiv; n++) {
        let unit = ioi / n;
        let counts = quantize(unit);

        // Least-squares refit of the grid unit, then snap the tempo
        // to a whole BPM and re-quantize.
        const num = counts.reduce((s, c, k) => s + c * iois[k], 0);
        const den = counts.reduce((s, c) => s + c * c, 0);
        unit = num / den;
        const bpm = Math.round(60000 / (unit * subdiv));
        if (bpm < bpmRange[0] || bpm > bpmRange[1]) continue;
        unit = 60000 / bpm / subdiv;
        counts = quantize(unit);

        // RMS timing error, measured in grid units.
        const error = Math.sqrt(
          counts.reduce((s, c, k) => s + ((iois[k] - c * unit) / unit) ** 2, 0) /
            iois.length
        );
        // Prefer tempos near ~120 BPM (log scale: 60 and 240 are equally far).
        const tempoCost = Math.log2(bpm / preferredBpm) ** 2;

        const cost = wError * error + wTempo * tempoCost + subdivCost;
        if (best === null || cost < best.cost) {
          best = { cost, bpm, subdiv, counts, error };
        }
      }
    }
  }

  // --- Metrical position (phase) ---------------------------------------
  // The first tap may fall anywhere in the bar (e.g. a pickup), so try every
  // grid position in the bar and keep the one where the taps line up best
  // with strong metrical positions.
  const { subdiv, counts } = best;
  const barUnits = subdiv * beatsPerBar;
  const relUnits = [0];
  for (const c of counts) relUnits.push(relUnits[relUnits.length - 1] + c);

  let offsetUnits;
  if (firstTapBeat !== null) {
    offsetUnits = Math.round(firstTapBeat * subdiv);
  } else {
    // Every tap counts for its position. Taps with a known length (the gap to
    // the next tap) count extra in proportion to it, since long notes tend to
    // start on strong beats. The last tap's length is unknown, so it adds no
    // length evidence: it counts for its position only.
    const lengths = [...counts, 0];
    let bestFit = -Infinity;
    for (let o = 0; o < barUnits; o++) {
      const fit = relUnits.reduce(
        (sum, u, i) =>
          sum + metricWeight((o + u) % barUnits, subdiv, beatsPerBar) * (1 + lengths[i]),
        0
      );
      if (fit > bestFit) {
        bestFit = fit;
        offsetUnits = o;
      }
    }
  }

  // Positions in beats from the start of the first tap's bar.
  const onsetBeats = relUnits.map((u) => (offsetUnits + u) / subdiv);
  const indicesWhere = (pred) =>
    onsetBeats.flatMap((pos, i) => (pred(pos) ? [i] : []));

  return {
    bpm: best.bpm,
    durations: best.counts.map((c) => `${c}/${best.subdiv}`), // in beats
    subdivision: best.subdiv,
    errorGridUnits: +best.error.toFixed(3),
    // 1.0 = perfect fit (cost 0); falls toward 0 as the cost grows.
    score: +Math.exp(-best.cost).toFixed(3),
    cost: +best.cost.toFixed(3),
    firstTapBeat: offsetUnits / subdiv, // 0 = on beat 1; 3.5 = pickup on the "and" of beat 4 (in 4/4)
    onsetBeats, // position of each tap, in beats from the start of the first bar
    onBeat: indicesWhere((pos) => Number.isInteger(pos)), // tap indices on any beat
    downbeats: indicesWhere((pos) => pos % beatsPerBar === 0), // tap indices on beat 1 of a bar
  };
}

/**
 * Metrical strength of a grid position within the bar: one point for each
 * level it sits on (grid unit, half beat, beat, half bar, bar). In 4/4 with
 * sixteenths: beat 1 = 5, beat 3 = 4, beats 2/4 = 3, eighths = 2, others = 1.
 */
function metricWeight(pos, subdiv, beatsPerBar) {
  let w = 1;
  if (subdiv % 2 === 0 && pos % (subdiv / 2) === 0) w++;
  if (pos % subdiv === 0) w++;
  if (beatsPerBar % 2 === 0 && pos % ((subdiv * beatsPerBar) / 2) === 0) w++;
  if (pos === 0) w++;
  return w;
}

export { transcribe, SUBDIVISION_COST };
