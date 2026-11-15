import { describe, it, expect } from "vitest";
import {
  createTapTracker, DEFAULTS, beatTimeMs, nextBeat, beatInBar, jitterLevel, scalePosition,
} from "./beat-tracker.js";

describe("createTapTracker", () => {
  it("needs two taps before reporting a tempo", () => {
    const tracker = createTapTracker()
    let r = tracker.tap(0);
    expect(r).toMatchObject({ denominator: 1, taps: [{t: 0, numerator: 1, d: null, seq: 0}] });
    r = tracker.tap(500);
    expect(r).toMatchObject({ denominator: 1, taps: [
      {t: 0, numerator: 1, d: 500, seq: 0},
      {t: 500, numerator: 1, d: null, seq: 1}]
     });
    r = tracker.tap(1000);
    expect(r).toMatchObject({ denominator: 1, taps: [
      {t: 0, numerator: 1, d: 500, seq: 0}, 
      {t: 500, numerator: 1, d: 500, seq: 1},
      {t: 1000, numerator: 1, d: null, seq: 2}]
    });
    expect(r.bpm).toBeCloseTo(120);
    });

});