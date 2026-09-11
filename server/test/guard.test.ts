import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/guard.ts';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createRateLimiter', () => {
  it('admits up to the limit per window and reports the wait when exceeded', () => {
    const c = clock();
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: c.now });

    expect(limiter.take()).toEqual({ ok: true });
    c.advance(300);
    expect(limiter.take()).toEqual({ ok: true });
    expect(limiter.take()).toEqual({ ok: false, retryAfterMs: 700 });

    c.advance(700); // the first admission leaves the window
    expect(limiter.take()).toEqual({ ok: true });
    expect(limiter.take()).toEqual({ ok: false, retryAfterMs: 300 });
  });

  it('is disabled at limit 0', () => {
    const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });
    for (let i = 0; i < 1000; i++) expect(limiter.take().ok).toBe(true);
  });

  it('rejects nonsensical options at construction', () => {
    expect(() => createRateLimiter({ limit: -1, windowMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1.5, windowMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow(RangeError);
  });
});
