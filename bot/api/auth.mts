import { hmacHex, safeEqual, sha256Hex } from '../verification/hash.mts';

// Every request between the site and the bot is signed. The signature covers body, path, method, time and a
// one-time nonce: a request cannot be altered, moved to another path or replayed.

export const SIGNATURE_WINDOW_MS = 60_000;

export interface SignedParts {
    ts: string;
    nonce: string;
    method: string;
    path: string;
    body: string;
}

export const signRequest = (secret: string, p: SignedParts): string =>
    hmacHex(secret, `${p.ts}.${p.nonce}.${p.method.toUpperCase()}.${p.path}.${sha256Hex(p.body)}`);

/** Remembers seen nonces for the signature window (in memory; after a restart the time window still protects). */
export class NonceStore {
    private readonly seen = new Map<string, number>();
    private readonly ttlMs: number;

    constructor(ttlMs = SIGNATURE_WINDOW_MS * 2) {
        this.ttlMs = ttlMs;
    }

    /** Records the nonce and returns true if first seen; false on a replay. */
    claim(nonce: string, now: number): boolean {
        if (this.seen.size > 5000) this.prune(now);
        const expires = this.seen.get(nonce);
        if (expires !== undefined && expires > now) return false;
        this.seen.set(nonce, now + this.ttlMs);
        return true;
    }

    private prune(now: number): void {
        for (const [nonce, expires] of this.seen) if (expires <= now) this.seen.delete(nonce);
    }
}

export type AuthResult = { ok: true } | { ok: false; reason: string };

export interface AuthOptions {
    secret: string;
    now: number;
    nonces: NonceStore;
    windowMs?: number;
}

export function verifyRequest(
    headers: Record<string, string | string[] | undefined>,
    method: string,
    path: string,
    body: string,
    options: AuthOptions,
): AuthResult {
    const header = (name: string): string => {
        const value = headers[name];
        return typeof value === 'string' ? value : '';
    };
    const ts = header('x-ts');
    const nonce = header('x-nonce');
    const signature = header('x-signature');

    if (!/^\d{10,16}$/.test(ts)) return { ok: false, reason: 'ts' };
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return { ok: false, reason: 'nonce' };
    if (!/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: 'signature-format' };

    if (Math.abs(options.now - Number(ts)) > (options.windowMs ?? SIGNATURE_WINDOW_MS)) {
        return { ok: false, reason: 'expired' };
    }

    const expected = signRequest(options.secret, { ts, nonce, method, path, body });
    if (!safeEqual(signature, expected)) return { ok: false, reason: 'signature' };

    // The nonce is recorded only AFTER the signature checks out, so forged requests cannot bloat the nonce list.
    if (!options.nonces.claim(nonce, options.now)) return { ok: false, reason: 'replay' };
    return { ok: true };
}
