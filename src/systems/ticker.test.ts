import { describe, expect, it } from 'vitest';
import { createTickClock, drainTicks } from './ticker';

describe('drainTicks', () => {
  it('fires no ticks on the very first call, regardless of `now`', () => {
    const clock = createTickClock();
    expect(drainTicks(clock, 999_999, 500)).toBe(0);
    expect(clock.accumulator).toBe(0);
  });

  it('fires no ticks while less than tickMs has elapsed', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500); // establishes lastFrameTime
    expect(drainTicks(clock, 499, 500)).toBe(0);
  });

  it('fires exactly one tick once tickMs has elapsed', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500);
    expect(drainTicks(clock, 500, 500)).toBe(1);
  });

  it('fires multiple ticks when a frame spans more than one tick (catch-up)', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500);
    expect(drainTicks(clock, 1700, 500)).toBe(3); // 3 * 500 = 1500 <= 1700
  });

  it('carries leftover fractional accumulator across calls without drift', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500);
    expect(drainTicks(clock, 300, 500)).toBe(0); // accumulator: 300
    expect(drainTicks(clock, 600, 500)).toBe(1); // accumulator: 300+300=600 -> fires, leaves 100
    expect(clock.accumulator).toBe(100);
    expect(drainTicks(clock, 1000, 500)).toBe(1); // accumulator: 100+400=500 -> fires exactly
    expect(clock.accumulator).toBe(0);
  });

  it('clamps a huge gap (e.g. a backgrounded tab) to maxCatchUpTicks instead of bursting', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500);
    // tab was backgrounded for a full minute; without clamping this would
    // fire 120 ticks at once
    expect(drainTicks(clock, 60_000, 500, 5)).toBe(5);
    expect(clock.accumulator).toBe(0);
  });

  it('respects a custom maxCatchUpTicks', () => {
    const clock = createTickClock();
    drainTicks(clock, 0, 500);
    expect(drainTicks(clock, 60_000, 500, 2)).toBe(2);
  });

  it('keeps pace steadily across many small frames summing to whole ticks', () => {
    const clock = createTickClock();
    let now = 0;
    let totalTicks = 0;
    drainTicks(clock, now, 500); // establishes lastFrameTime at 0
    // 40 frames of exactly 25ms each = 1000ms = 2 ticks @ 500ms
    for (let i = 0; i < 40; i++) {
      now += 25;
      totalTicks += drainTicks(clock, now, 500);
    }
    expect(totalTicks).toBe(2);
  });
});
