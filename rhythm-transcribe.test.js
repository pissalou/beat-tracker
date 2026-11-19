import { describe, it, expect } from "vitest";
import { transcribe } from "./rhythm-transcribe.js";

describe("transcribe", () => {
  it("transcribes exact taps as 6/4, 2/4, 3/4 at 120 bpm", () => {
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
    expect(result.firstTapBeat).toBe(0);
    expect(result.onsetBeats).toEqual([0, 1.5, 2, 2.75]);
    expect(result.onBeat).toEqual([0, 2]);
    expect(result.downbeats).toEqual([0]);
  });

  it("marks taps on beat 1 of each bar as downbeats in 2/4", () => {
    const result = transcribe([0, 750, 1000, 1375], { beatsPerBar: 2 });

    expect(result.downbeats).toEqual([0, 2]);
  });

  it("detects a pickup: first tap off the beat", () => {
    // Eighth-note pickup, then quarter notes.
    const result = transcribe([0, 250, 750, 1250, 1750, 2250]);

    expect(result.bpm).toBe(120);
    expect(result.firstTapBeat).toBe(3.5); // the "and" of beat 4
    expect(result.onBeat).toEqual([1, 2, 3, 4, 5]);
    expect(result.downbeats).toEqual([1, 5]);
  });

  it("lets the caller force the first tap's position", () => {
    const result = transcribe([0, 750, 1000, 1375], { firstTapBeat: 0.5 });

    expect(result.onsetBeats).toEqual([0.5, 2, 2.5, 3.25]);
    expect(result.onBeat).toEqual([1]);
    expect(result.downbeats).toEqual([]);
  });

  it("gives the same transcription for taps with human timing jitter", () => {
    const result = transcribe([0, 742, 1003, 1381]);

    expect(result.bpm).toBe(120);
    expect(result.durations).toEqual(["6/4", "2/4", "3/4"]);
    expect(result.subdivision).toBe(4);
    expect(result.errorGridUnits).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
    expect(result.downbeats).toEqual([0]);
  });
});