/**
 * In-memory sliding window rate limiter.
 *
 * Works per Vercel serverless instance (not shared across instances),
 * but still effective against single-source bursts on the same instance.
 *
 * Usage:
 *   const rl = getRateLimiter('chat', { limit: 10, windowMs: 60_000 });
 *   const { ok, remaining } = rl.check(ip);
 */

interface RateLimitOptions {
    limit: number;       // max requests per window
    windowMs: number;    // window size in milliseconds
}

interface Bucket {
    timestamps: number[];
}

class RateLimiter {
    private buckets = new Map<string, Bucket>();
    private readonly limit: number;
    private readonly windowMs: number;

    constructor(opts: RateLimitOptions) {
        this.limit = opts.limit;
        this.windowMs = opts.windowMs;
    }

    check(key: string): { ok: boolean; remaining: number; resetMs: number } {
        const now = Date.now();
        const cutoff = now - this.windowMs;

        let bucket = this.buckets.get(key);
        if (!bucket) {
            bucket = { timestamps: [] };
            this.buckets.set(key, bucket);
        }

        // Slide the window: drop old timestamps
        bucket.timestamps = bucket.timestamps.filter(t => t > cutoff);

        if (bucket.timestamps.length >= this.limit) {
            const oldestInWindow = bucket.timestamps[0];
            return {
                ok: false,
                remaining: 0,
                resetMs: oldestInWindow + this.windowMs - now,
            };
        }

        bucket.timestamps.push(now);

        // Periodic cleanup to prevent unbounded memory growth
        if (this.buckets.size > 10_000) {
            for (const [k, b] of this.buckets.entries()) {
                if (b.timestamps.every(t => t <= cutoff)) {
                    this.buckets.delete(k);
                }
            }
        }

        return {
            ok: true,
            remaining: this.limit - bucket.timestamps.length,
            resetMs: 0,
        };
    }
}

// Singleton limiters by name
const limiters = new Map<string, RateLimiter>();

export function getRateLimiter(name: string, opts: RateLimitOptions): RateLimiter {
    if (!limiters.has(name)) {
        limiters.set(name, new RateLimiter(opts));
    }
    return limiters.get(name)!;
}

/**
 * Extract client IP from Next.js request headers.
 * Vercel sets x-forwarded-for; fallback to x-real-ip.
 */
export function getClientIp(req: Request): string {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
    const real = req.headers.get('x-real-ip');
    if (real) return real.trim();
    return 'unknown';
}

/**
 * Convenience: check rate limit and return a 429 Response if exceeded.
 * Returns null if request is allowed.
 */
export function checkRateLimit(
    req: Request,
    name: string,
    opts: RateLimitOptions,
    corsHeaders?: Record<string, string>
): Response | null {
    const ip = getClientIp(req);
    const limiter = getRateLimiter(name, opts);
    const result = limiter.check(ip);

    if (!result.ok) {
        const retryAfter = Math.ceil(result.resetMs / 1000);
        return new Response(
            JSON.stringify({ error: 'Слишком много запросов. Попробуйте позже.' }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(retryAfter),
                    'X-RateLimit-Limit': String(opts.limit),
                    'X-RateLimit-Remaining': '0',
                    ...(corsHeaders || {}),
                },
            }
        );
    }

    return null;
}
