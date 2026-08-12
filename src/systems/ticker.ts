// Fixed-timestep tick accumulator: converts wall-clock frame timestamps
// (e.g. from requestAnimationFrame) into a count of whole simulation ticks
// due this frame. Kept free of GameState/DOM so the pacing algorithm itself
// — as opposed to what a tick actually does — can be unit tested directly
// (see game.ts's frame(), the only caller).
export interface TickClock {
  accumulator: number;
  lastFrameTime: number | null;
}

export function createTickClock(): TickClock {
  return { accumulator: 0, lastFrameTime: null };
}

// Advances the clock by however much wall-clock time has passed since the
// previous call (using `now`, a monotonic timestamp), and returns how many
// whole ticks of length tickMs are due to run this frame — 0 most frames,
// occasionally more than 1 if a frame runs long. A backgrounded/throttled
// tab can leave a huge gap between frames; dt is clamped to
// maxCatchUpTicks * tickMs so resuming doesn't burst-process an unbounded
// backlog of ticks at once. Leftover fractional accumulator carries over
// between calls, so cadence doesn't drift over time.
export function drainTicks(
  clock: TickClock,
  now: number,
  tickMs: number,
  maxCatchUpTicks = 5,
): number {
  if (clock.lastFrameTime === null) clock.lastFrameTime = now;
  const dt = now - clock.lastFrameTime;
  clock.accumulator += Math.min(dt, tickMs * maxCatchUpTicks);
  clock.lastFrameTime = now;

  let ticks = 0;
  while (clock.accumulator >= tickMs) {
    clock.accumulator -= tickMs;
    ticks++;
  }
  return ticks;
}
