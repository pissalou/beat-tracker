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

  return {
    bpm: best.bpm,
    durations: best.counts.map((c) => `${c}/${best.subdiv}`), // in beats
    subdivision: best.subdiv,
    errorGridUnits: +best.error.toFixed(3),
    // 1.0 = perfect fit (cost 0); falls toward 0 as the cost grows.
    score: +Math.exp(-best.cost).toFixed(3),
    cost: +best.cost.toFixed(3),
  };
}

export { transcribe, SUBDIVISION_COST };
