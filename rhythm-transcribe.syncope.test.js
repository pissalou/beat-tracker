import { describe, it, expect } from "vitest";
import { transcribe } from "./rhythm-transcribe.js";

describe("transcribe", () => {
  it("transcribe seven nation army without jitter", () => {
    const t0 = 0;
    const t1 = t0 + 750;
    const t2 = t1 + 250;
    const t3 = t2 + 375;

    const result = transcribe([t0, t1, t2, t3]);

    expect(result.bpm).toBe(120);
    expect(result.durations).toEqual(["6/4", "2/4", "3/4"]);
    expect(result.subdivision).toBe(4);
    expect(result.errorGridUnits).toBe(0);
    expect(result.score).toBeCloseTo(0.905, 3);
  });

  it("transcribe seven nation army with jitter", () => {
    const result = transcribe([0, 742, 1003, 1381]);

    expect(result.bpm).toBe(120);
    expect(result.durations).toEqual(["6/4", "2/4", "3/4"]);
    expect(result.subdivision).toBe(4);
    expect(result.errorGridUnits).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });
});