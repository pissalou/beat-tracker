/**
 * Tap-tempo tracker: turns tap timestamps into tempo, phase and jitter.
 *
 * Pure logic with no DOM, audio or timers, so it can be unit tested on its own.
 * All times are milliseconds on one monotonic clock, such as performance.now()
 * or Event.timeStamp.
 */

export const DEFAULTS = Object.freeze({
  window: 4,          // intervals in the moving average
  resetMs: 2000,      // a gap longer than this starts a new count
  minIntervalMs: 100, // taps closer than this are ignored (switch bounce, double triggers)
});

const IGNORED = Object.freeze({ ignored: true });

/**
 * @typedef {object} TapReading
 * @property {false} ignored
 * @property {"first"|"pause"|null} restart  why this tap began a new count, if it did
 * @property {number} seq          beat number of this tap; 0 is the downbeat of the count.
 * @property {number} taps         taps in the moving window
 * @property {number} intervals    intervals in the moving window
 * @property {number|null} periodMs   moving average of the window intervals
 * @property {number|null} bpm        60000 / periodMs
 * @property {number} beatNumber   0-based beat number the grid origin refers to
 * @property {number} gridOriginMs phase-averaged time of beat beatNumber; beat q falls at
 *                                 gridOriginMs + (q - beatNumber) × periodMs
 * @property {number|null} jitter     sample standard deviation of the window intervals / periodMs
 * @property {number|null} averageBpm tempo over every interval of the current count
 */

/** @param {Partial<typeof DEFAULTS>} [options] */
export function createTapTracker(options = {}) {
  const opts = Object.freeze({ ...DEFAULTS, ...options });
  if (!Number.isInteger(opts.window) || opts.window < 1) throw new RangeError("window must be an integer ≥ 1");
  if (!(opts.resetMs > 0)) throw new RangeError("resetMs must be > 0");
  if (!(opts.minIntervalMs >= 0)) throw new RangeError("minIntervalMs must be ≥ 0");

  let taps = [];        // {t, seq}, at most window + 1
  let seq = 0;          // next beat number
  let totalMs = 0;      // sum of every interval in the current count
  let totalN = 0;

  function reset() {
    taps = [];
    seq = 0;
    totalMs = 0;
    totalN = 0;
  }

  /** 
   * @param {number} timeMs from a monotonic clock, such as performance.now() or Event.timeStamp 
   * @returns {TapReading | {ignored: true}} 
   **/
  function tap(timeMs) {
    if (!Number.isFinite(timeMs)) throw new TypeError("tap time must be a finite number of milliseconds");

    let last = taps[taps.length - 1];
    let restart = null;

    if (last && timeMs - last.t < opts.minIntervalMs) return IGNORED;  // also rejects time going backwards
    if (last && timeMs - last.t > opts.resetMs) {
      reset();
      last = undefined;
      restart = "pause";
    }

    if (!last) {
      restart ??= "first";
    } else if (taps.length >= 1) {
      const previousDuration = timeMs - last.t; // current interval
      last.d = previousDuration; // update the last tap's interval
    }

    if (last) {
      totalMs += timeMs - last.t;
      totalN++;
    }
    taps.push({ t: timeMs, d: null, seq: seq++ });
    if (taps.length > opts.window + 1) taps.shift();

    return reading(restart);
  }

  function reading(restart) {
    const first = taps[0];
    const end = taps[taps.length - 1];
    const base = { ignored: false, restart, taps: taps };

    if (taps.length < 2) {
      return Object.freeze({ ...base, periodMs: null, bpm: null, beatNumber: end.seq, gridOriginMs: end.t,
                             jitter: null, averageBpm: null });
    }

    // Moving average of the window intervals = span / number of intervals.
    const periodMs = taps.map(t => t.d).reduce((sum, d) => sum + d, 0) / (taps.length - 1);

    // Phase: each tap's estimate of when beat first.seq fell, averaged, so a single
    // early or late tap moves the grid by only a fraction of its error.
    let sum = 0;
    for (const k of taps) sum += k.t - (k.seq - first.seq) * periodMs;

    let jitter = null;
    if (taps.length >= 3) {
      let ss = 0;
      for (let i = 1; i < taps.length; i++) {
        const d = taps[i].t - taps[i - 1].t - periodMs;
        ss += d * d;
      }
      jitter = Math.sqrt(ss / (taps.length - 2)) / periodMs;   // sample SD over (intervals − 1)
    }

    return Object.freeze({
      ...base,
      periodMs,
      bpm: 60000 / periodMs,
      beatNumber: first.seq,
      gridOriginMs: sum / taps.length,
      jitter,
      averageBpm: 60000 / (totalMs / totalN),
    });
  }

  return {
    tap,
    reset,
    /** True when taps exist and none has arrived for more than resetMs. */
    isIdle: nowMs => taps.length > 0 && nowMs - taps[taps.length - 1].t > opts.resetMs,
    get options() { return opts; },
  };
}

/** Time of beat `seq` on the reading's grid, or null before two taps. */
export function beatTimeMs(reading, seq) {
  if (reading.periodMs == null) return null;
  return reading.gridOriginMs + (seq - reading.beatNumber) * reading.periodMs;
}

/** First beat strictly after `afterMs`, as {seq, timeMs}, or null before two taps. */
export function nextBeat(reading, afterMs) {
  if (reading.periodMs == null) return null;
  let seq = Math.floor((afterMs - reading.gridOriginMs) / reading.periodMs) + reading.beatNumber + 1;
  if (beatTimeMs(reading, seq - 1) > afterMs) seq--;   // guard against floating-point edge cases
  return { seq, timeMs: beatTimeMs(reading, seq) };
}

/** Position of a beat within the bar; 0 is the downbeat. Works for negative seq. */
export const beatInBar = (seq, beatsPerBar) => ((seq % beatsPerBar) + beatsPerBar) % beatsPerBar;

/** Classify jitter: "none" when unmeasured, else steady / loose / unsteady. */
export function jitterLevel(jitter, { steady = 0.05, loose = 0.10 } = {}) {
  if (jitter == null || Number.isNaN(jitter)) return "none";
  return jitter <= steady ? "steady" : jitter <= loose ? "loose" : "unsteady";
}
