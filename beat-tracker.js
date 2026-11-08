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
  outlierLow: 0.6,    // an interval shorter than average × outlierLow restarts the count
  outlierHigh: 1.6,   // an interval longer than average × outlierHigh restarts the count
});

const IGNORED = Object.freeze({ ignored: true });

/**
 * @typedef {object} TapReading
 * @property {false} ignored
 * @property {"first"|"pause"|"outlier"|null} restart  why this tap began a new count, if it did
 * @property {number} seq          beat number of this tap; 0 is the downbeat of the count.
 *                                 An outlier restart keeps numbering so the downbeat stays put.
 * @property {number} taps         taps in the moving window
 * @property {number} intervals    intervals in the moving window
 * @property {number|null} periodMs   moving average of the window intervals
 * @property {number|null} bpm        60000 / periodMs
 * @property {number} anchorSeq    beat number the anchor refers to
 * @property {number} anchorMs     phase-averaged time of beat anchorSeq; beat q falls at
 *                                 anchorMs + (q - anchorSeq) × periodMs
 * @property {number|null} jitter     sample standard deviation of the window intervals / periodMs
 * @property {number|null} averageBpm tempo over every interval of the current count
 */

/** @param {Partial<typeof DEFAULTS>} [options] */
export function createTapTracker(options = {}) {
  const opts = Object.freeze({ ...DEFAULTS, ...options });
  if (!Number.isInteger(opts.window) || opts.window < 1) throw new RangeError("window must be an integer ≥ 1");
  if (!(opts.resetMs > 0)) throw new RangeError("resetMs must be > 0");
  if (!(opts.minIntervalMs >= 0)) throw new RangeError("minIntervalMs must be ≥ 0");
  if (!(opts.outlierLow > 0 && opts.outlierLow < 1 && opts.outlierHigh > 1)) {
    throw new RangeError("outlier bounds must satisfy 0 < outlierLow < 1 < outlierHigh");
  }

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

  /** @param {number} timeMs @returns {TapReading | {ignored: true}} */
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
    } else if (taps.length >= 2) {
      const avg = (last.t - taps[0].t) / (last.seq - taps[0].seq);
      const iv = timeMs - last.t;
      if (iv < avg * opts.outlierLow || iv > avg * opts.outlierHigh) {
        taps = [last];             // follow the new tempo at once
        totalMs = 0;
        totalN = 0;
        restart = "outlier";
      }
    }

    if (last) {
      totalMs += timeMs - last.t;
      totalN++;
    }
    taps.push({ t: timeMs, seq: seq++ });
    if (taps.length > opts.window + 1) taps.shift();

    return reading(restart);
  }

  function reading(restart) {
    const first = taps[0];
    const end = taps[taps.length - 1];
    const base = { ignored: false, restart, seq: end.seq, taps: taps.length, intervals: taps.length - 1 };

    if (taps.length < 2) {
      return Object.freeze({ ...base, periodMs: null, bpm: null, anchorSeq: end.seq, anchorMs: end.t,
                             jitter: null, averageBpm: null });
    }

    // Moving average of the window intervals = span / number of intervals.
    const periodMs = (end.t - first.t) / (end.seq - first.seq);

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
      anchorSeq: first.seq,
      anchorMs: sum / taps.length,
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
  return reading.anchorMs + (seq - reading.anchorSeq) * reading.periodMs;
}

/** First beat strictly after `afterMs`, as {seq, timeMs}, or null before two taps. */
export function nextBeat(reading, afterMs) {
  if (reading.periodMs == null) return null;
  let seq = Math.floor((afterMs - reading.anchorMs) / reading.periodMs) + reading.anchorSeq + 1;
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

/** Fraction 0–1 along a fixed tempo scale, clamped at the ends. */
export function scalePosition(bpm, min = 40, max = 280) {
  return Math.max(0, Math.min(1, (bpm - min) / (max - min)));
}
