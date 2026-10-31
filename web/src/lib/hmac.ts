import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
}

export const randomString = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export interface SignedParts {
    ts: string;
    nonce: string;
    method: string;
    path: string;
    body: string;
}

/** Exactly the same format as signRequest in the bot's api/auth.mts (verified by the contract test). */
export const signRequest = (secret: string, p: SignedParts): string =>
    createHmac('sha256', secret)
        .update(`${p.ts}.${p.nonce}.${p.method.toUpperCase()}.${p.path}.${sha256Hex(p.body)}`)
        .digest('hex');
