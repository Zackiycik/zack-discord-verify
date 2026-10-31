export interface LimitResult {
    allowed: boolean;
    retryAfterSec: number;
}

/** In-memory fixed-window limiter. Enough for a single process; resets on restart. */
export class RateLimiter {
    private readonly windows = new Map<string, { count: number; resetAt: number }>();

    hit(key: string, limit: number, windowMs: number, now: number): LimitResult {
        if (this.windows.size > 10_000) this.prune(now);

        const current = this.windows.get(key);
        if (!current || current.resetAt <= now) {
            this.windows.set(key, { count: 1, resetAt: now + windowMs });
            return { allowed: true, retryAfterSec: 0 };
        }
        if (current.count >= limit) {
            return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
        }
        current.count++;
        return { allowed: true, retryAfterSec: 0 };
    }

    private prune(now: number): void {
        for (const [key, value] of this.windows) if (value.resetAt <= now) this.windows.delete(key);
    }
}
