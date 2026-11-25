import { describe, it, expect } from "vitest";
import {
  createTapTracker, TapReading, DEFAULTS, beatTimeMs, nextBeat, beatInBar, jitterLevel, scalePosition,
} from "./beat-tracker.js";

describe("createTapTracker", () => {

  it("measures jitter as the coefficient of variation of the window", () => {
    const r = tapAll(createTapTracker(), [0, 480, 1000, 1480, 2000]).at(-1);  // 480, 520, 480, 520
    const sd = Math.sqrt((4 * 20 ** 2) / 3);
    expect(r.periodMs).toBeCloseTo(500);
    expect(r.jitter).toBeCloseTo(sd / 500, 10);
  });

    it("averages phase so one early and one late tap cancel out", () => {
    const r = tapAll(createTapTracker(), [1000, 1510, 1990, 2500]).at(-1);
    expect(r.periodMs).toBeCloseTo(500);
    expect(r.beatNumber).toBe(0);
    expect(r.gridOriginMs).toBeCloseTo(1000);
  });
});
