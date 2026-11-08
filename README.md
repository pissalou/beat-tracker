# beat-tracker
ECMAScript module that can "feel the beat" by measuring length of notes received

## API
- `createTapTracker(options)` returns an object with three methods:
    - `tap(timeMs)` takes a timestamp in milliseconds. Each tap returns a frozen reading:
    - `bpm` and `periodMs`: the tempo from the moving average.
    - `averageBpm`: the tempo over the whole count.
- `jitter`: the coefficient of variation of the recent intervals.
- `anchorMs` and `anchorSeq`: the phase-averaged beat position.
- `seq`: this tap’s beat number.
- `restart`: "first", "pause", "outlier" or null, saying why a new count began.
- `reset()` clears everything.
- `isIdle(nowMs)` says whether more than 2 seconds have passed since the last tap.

The module also exports pure helpers: beatTimeMs, nextBeat, beatInBar, jitterLevel and scalePosition. The default window, reset gap and outlier limits are in DEFAULTS, and you can override any of them.