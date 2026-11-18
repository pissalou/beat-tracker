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
 * A frozen reading of the tap tracker's current tempo and beat grid.
 * @property {false} ignored
 * @property {"first"|"pause"|null} restart why this tap began a new count, if it did
 * @property {number} denominator
 * @property {Array<{t: number, numerator: number|null, d: number|null, seq: number}>} taps
 * @property {number|null} periodMs moving average of the window intervals
 * @property {number|null} bpm 60000 / periodMs
 * @property {number} beatNumber 0-based beat number the grid origin refers to
 * @property {number} gridOriginMs phase-averaged time of beat beatNumber
 * @property {number|null} jitter sample standard deviation of window intervals / periodMs
 * @property {number|null} averageBpm tempo over every interval of the current count
 */
export class TapReading {
  /**
   * @param {{
   *   restart: "first"|"pause"|null,
   *   denominator: number,
   *   taps: Array<{t: number, numerator: number|null, d: number|null, seq: number}>,
   *   periodMs: number|null,
   *   bpm: number|null,
   *   beatNumber: number,
   *   gridOriginMs: number,
   *   jitter: number|null,
   *   averageBpm: number|null
   * }} values
   */
  constructor(values) {
    Object.assign(this, { ignored: false, ...values });
    Object.freeze(this);
  }

  toString() {
    const bpm = this.bpm == null ? "unavailable" : `${this.bpm} BPM`;
    const ratios = this.taps.map(tap => `${tap.numerator}/${this.denominator}`).join(", ");
    return `${bpm}; taps: ${ratios}`; // numerator of the last tap will always be 1
  }
}

/** @param {Partial<typeof DEFAULTS>} [options] */
export function createTapTracker(options = {}) {
  const opts = Object.freeze({ ...DEFAULTS, ...options });
  if (!Number.isInteger(opts.window) || opts.window < 1) throw new RangeError("window must be an integer ≥ 1");
  if (!(opts.resetMs > 0)) throw new RangeError("resetMs must be > 0");
  if (!(opts.minIntervalMs >= 0)) throw new RangeError("minIntervalMs must be ≥ 0");

  let taps = [];        // {t, seq}, at most window + 1
  let seq = 0;          // next beat number
  let denominator = 1;  // for representing fractional durations, e.g. 3/4  of a beat
  let totalMs = 0;      // sum of every interval in the current count
  let totalN = 0;

  function reset() {
    taps = [];
    seq = 0;
    denominator = 1;
    totalMs = 0;
    totalN = 0;
  }

  function greatestCommonDivisor(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function sum(numbers) {
  return numbers.reduce((total, num) => total + num, 0);
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

    let numerator = null;
    if (!last) {
      restart ??= "first"; // first tap of a new count
      numerator = 1;
    } else {
      const previousDuration = timeMs - last.t;
      last.d = previousDuration; // update the last tap
      console.log("iteration", taps.length);
      if (taps.length >= 2) {
        const allDurations = taps.map(t => t.d);
        const gcd = allDurations.reduce((a, b) => greatestCommonDivisor(a, b));
        if (allDurations.every(d => Math.max(d, previousDuration) % gcd === 0)) {
          // all durations are multiples of each other, so we can represent them as a fraction of a beat
          console.log("gcd", gcd, "allDurations", allDurations);
          let maxDenominator = Math.max(...allDurations) / gcd;
          if (denominator < 4 && maxDenominator > 4) {
            maxDenominator = 4; // limit denominator to 4 for common time signatures
          }
          denominator = Math.max(denominator, maxDenominator);
          console.log("denominator", denominator, "maxAllDurations", Math.max(...allDurations));
          // update the numerators of all taps to reflect the new denominator
          taps.forEach(tap => {
              tap.numerator = tap.d / gcd;
          });
          console.log("sumAllDurations", sum(allDurations), "updated taps", taps);
        }
      }
      numerator = denominator; // for now, we only support whole beats; could be extended to support fractional beats
    }

    if (last) {
      totalMs += timeMs - last.t;
      totalN++;
    }
    taps.push({ t: timeMs, numerator, d: null, seq: seq++ });
    if (taps.length > opts.window + 1) taps.shift();

    return reading(restart);
  }

  function reading(restart) {
    const first = taps[0];
    const end = taps[taps.length - 1];
    const base = { ignored: false, restart, denominator, taps };

    if (taps.length < 2) {
      return new TapReading({ ...base, periodMs: null, bpm: null, beatNumber: end.seq, gridOriginMs: end.t,
                              jitter: null, averageBpm: null });
    }

    // 
    const periodMs = taps[0].d == null ? null : (taps[0].d / taps[0].numerator) * denominator;  // moving average of the window intervals

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

    return new TapReading({
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
