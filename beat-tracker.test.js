import { describe, it, expect } from "vitest";
import {
  createTapTracker, DEFAULTS, beatTimeMs, nextBeat, beatInBar, jitterLevel, scalePosition,
} from "./beat-tracker.js";

/** Tap at each time in order and return every reading. */
const tapAll = (tracker, times) => times.map(t => tracker.tap(t));
/** Evenly spaced tap times. */
const evenly = (n, intervalMs, start = 0) => Array.from({ length: n }, (_, i) => start + i * intervalMs);

describe("createTapTracker", () => {
  it("needs two taps before reporting a tempo", () => {
    const r = createTapTracker().tap(1000);
    expect(r).toMatchObject({ ignored: false, restart: "first", seq: 0, taps: 1, intervals: 0 });
    expect(r.bpm).toBeNull();
    expect(r.periodMs).toBeNull();
    expect(r.jitter).toBeNull();
    expect(r.averageBpm).toBeNull();
  });

  it("reports steady 120 BPM with zero jitter", () => {
    const r = tapAll(createTapTracker(), evenly(5, 500)).at(-1);
    expect(r.bpm).toBeCloseTo(120);
    expect(r.averageBpm).toBeCloseTo(120);
    expect(r.jitter).toBe(0);
    expect(r.restart).toBeNull();
    expect(r.seq).toBe(4);
  });

  it("averages only the last `window` intervals", () => {
    const t = createTapTracker();
    const times = [...evenly(5, 500), ...evenly(4, 450, 2450)];   // 4 × 500 ms, then 4 × 450 ms
    const r = tapAll(t, times).at(-1);
    expect(r.intervals).toBe(4);
    expect(r.bpm).toBeCloseTo(60000 / 450);         // window holds only the 450 ms intervals
    expect(r.averageBpm).toBeCloseTo(60000 / 475);  // whole count: mean of 500 and 450
  });

  it("honours a custom window size", () => {
    const r = tapAll(createTapTracker({ window: 2 }), [0, 600, 1100, 1600]).at(-1);
    expect(r.intervals).toBe(2);
    expect(r.periodMs).toBeCloseTo(500);
  });

  it("measures jitter as the coefficient of variation of the window", () => {
    const r = tapAll(createTapTracker(), [0, 480, 1000, 1480, 2000]).at(-1);  // 480, 520, 480, 520
    const sd = Math.sqrt((4 * 20 ** 2) / 3);
    expect(r.periodMs).toBeCloseTo(500);
    expect(r.jitter).toBeCloseTo(sd / 500, 10);
  });

  it("leaves jitter unmeasured with a single interval", () => {
    const r = tapAll(createTapTracker(), [0, 500]).at(-1);
    expect(r.bpm).toBeCloseTo(120);
    expect(r.jitter).toBeNull();
  });

  it("averages phase so one early and one late tap cancel out", () => {
    const r = tapAll(createTapTracker(), [1000, 1510, 1990, 2500]).at(-1);
    expect(r.periodMs).toBeCloseTo(500);
    expect(r.anchorSeq).toBe(0);
    expect(r.anchorMs).toBeCloseTo(1000);
  });

  describe("restarting a count", () => {
    it("restarts after a gap longer than resetMs", () => {
      const t = createTapTracker();
      tapAll(t, evenly(4, 500));
      const r = t.tap(1500 + 2001);
      expect(r).toMatchObject({ restart: "pause", seq: 0, taps: 1 });
      expect(r.averageBpm).toBeNull();
    });

    it("does not restart at exactly resetMs", () => {
      const t = createTapTracker();
      t.tap(0);
      const r = t.tap(DEFAULTS.resetMs);
      expect(r.restart).toBeNull();
      expect(r.bpm).toBeCloseTo(30);
    });

    it("restarts on a much shorter interval and follows the new tempo at once", () => {
      const t = createTapTracker();
      tapAll(t, evenly(5, 500));
      const r = t.tap(2000 + 250);
      expect(r.restart).toBe("outlier");
      expect(r.intervals).toBe(1);
      expect(r.bpm).toBeCloseTo(240);
      expect(r.averageBpm).toBeCloseTo(240);
      expect(r.seq).toBe(5);   // beat numbering continues, so the downbeat does not move
    });

    it("restarts on a much longer interval", () => {
      const t = createTapTracker();
      tapAll(t, evenly(4, 500));
      expect(t.tap(1500 + 900).restart).toBe("outlier");
    });

    it("keeps intervals inside the outlier bounds", () => {
      const t = createTapTracker();
      tapAll(t, evenly(4, 500));
      expect(t.tap(1500 + 310).restart).toBeNull();  // 0.62 × average
      expect(t.tap(1810 + 700).restart).toBeNull();  // average is now 452.5 ms; 700 < 1.6 × 452.5
    });

    it("starts fresh after reset()", () => {
      const t = createTapTracker();
      tapAll(t, evenly(4, 500));
      t.reset();
      expect(t.tap(1600)).toMatchObject({ restart: "first", seq: 0 });
    });
  });

  it("ignores taps closer than minIntervalMs without changing state", () => {
    const t = createTapTracker();
    tapAll(t, [0, 500]);
    expect(t.tap(530)).toEqual({ ignored: true });
    expect(t.tap(400)).toEqual({ ignored: true });   // time going backwards
    const r = t.tap(1000);
    expect(r.seq).toBe(2);
    expect(r.bpm).toBeCloseTo(120);
  });

  it("reports idleness after resetMs without a tap", () => {
    const t = createTapTracker();
    expect(t.isIdle(10_000)).toBe(false);   // nothing tapped yet
    t.tap(0);
    expect(t.isIdle(2000)).toBe(false);
    expect(t.isIdle(2001)).toBe(true);
  });

  it("returns frozen readings", () => {
    const r = tapAll(createTapTracker(), [0, 500]).at(-1);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it("rejects invalid input", () => {
    expect(() => createTapTracker().tap(NaN)).toThrow(TypeError);
    expect(() => createTapTracker({ window: 0 })).toThrow(RangeError);
    expect(() => createTapTracker({ window: 2.5 })).toThrow(RangeError);
    expect(() => createTapTracker({ resetMs: 0 })).toThrow(RangeError);
    expect(() => createTapTracker({ outlierLow: 1.2 })).toThrow(RangeError);
  });
});

describe("beat grid helpers", () => {
  const r = tapAll(createTapTracker(), evenly(4, 500, 1000)).at(-1);  // beats 0–3 at 1000…2500

  it("places beats on the grid", () => {
    expect(beatTimeMs(r, 0)).toBeCloseTo(1000);
    expect(beatTimeMs(r, 10)).toBeCloseTo(6000);
    expect(beatTimeMs(r, -2)).toBeCloseTo(0);
  });

  it("finds the first beat strictly after a time", () => {
    expect(nextBeat(r, 2600)).toEqual({ seq: 4, timeMs: 3000 });
    expect(nextBeat(r, 3000)).toEqual({ seq: 5, timeMs: 3500 });
    expect(nextBeat(r, 0)).toEqual({ seq: -1, timeMs: 500 });
  });

  it("returns null before a tempo exists", () => {
    const one = createTapTracker().tap(0);
    expect(beatTimeMs(one, 3)).toBeNull();
    expect(nextBeat(one, 0)).toBeNull();
  });

  it("maps beat numbers into the bar", () => {
    expect([0, 1, 2, 3, 4, 7].map(s => beatInBar(s, 4))).toEqual([0, 1, 2, 3, 0, 3]);
    expect(beatInBar(-1, 4)).toBe(3);
  });
});

describe("display helpers", () => {
  it("classifies jitter at the 5 % and 10 % boundaries", () => {
    expect(jitterLevel(null)).toBe("none");
    expect(jitterLevel(NaN)).toBe("none");
    expect(jitterLevel(0)).toBe("steady");
    expect(jitterLevel(0.05)).toBe("steady");
    expect(jitterLevel(0.0501)).toBe("loose");
    expect(jitterLevel(0.10)).toBe("loose");
    expect(jitterLevel(0.1001)).toBe("unsteady");
    expect(jitterLevel(0.03, { steady: 0.02, loose: 0.05 })).toBe("loose");
  });

  it("positions tempo on the fixed 40–280 scale", () => {
    expect(scalePosition(40)).toBe(0);
    expect(scalePosition(160)).toBe(0.5);
    expect(scalePosition(280)).toBe(1);
    expect(scalePosition(20)).toBe(0);
    expect(scalePosition(300)).toBe(1);
  });
});
