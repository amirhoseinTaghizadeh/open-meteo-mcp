// Sliding-window rate limiter for the whole process. There is no client
// identity here, so the budget is simply how much this server calls Open-Meteo.

export interface RateLimiterOptions {
  limit: number; // 0 disables
  windowMs: number;
  now?: () => number; // for tests
}

export type Admission = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  take(): Admission;
}

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  if (!Number.isInteger(limit) || limit < 0) throw new RangeError(`Invalid rate limit: ${limit}`);
  if (!(windowMs > 0)) throw new RangeError(`Invalid rate limit window: ${windowMs}`);

  const admitted: number[] = [];

  return {
    take() {
      if (limit === 0) return { ok: true };
      const t = now();
      while (admitted.length > 0 && (admitted[0] ?? t) <= t - windowMs) admitted.shift();
      if (admitted.length >= limit) {
        return { ok: false, retryAfterMs: (admitted[0] ?? t) + windowMs - t };
      }
      admitted.push(t);
      return { ok: true };
    },
  };
}

export const unlimited: RateLimiter = { take: () => ({ ok: true }) };
