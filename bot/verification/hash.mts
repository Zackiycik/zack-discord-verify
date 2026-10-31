import crypto from 'node:crypto';
import net from 'node:net';

export const sha256Hex = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export const hmacHex = (secret: string, data: string): string =>
    crypto.createHmac('sha256', secret).update(data).digest('hex');

export function safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Random, unguessable session/result key. Only its sha256 is stored in the DB. */
export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

/**
 * IPs, device ids and fingerprints are never stored raw. Plain SHA-256 is not enough (the IPv4
 * space is small enough to brute-force), so a secret "pepper" is mixed in via HMAC. `kind` separates the domains.
 */
export const hashValue = (pepper: string, kind: 'ip' | 'device' | 'fp', value: string): string =>
    hmacHex(pepper, `${kind}:${value}`);

const tokenSignature = (secret: string, id: string): string =>
    crypto.createHmac('sha256', secret).update(`device:${id}`).digest('base64url');

/** Device token: "<uuid>.<signature>". Being signed, a client cannot invent someone else's id. */
export function mintDeviceToken(secret: string): string {
    const id = crypto.randomUUID();
    return `${id}.${tokenSignature(secret, id)}`;
}

/** Returns the device id (uuid) if valid, null if forged/garbled. */
export function verifyDeviceToken(secret: string, token: unknown): string | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const id = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    return safeEqual(signature, tokenSignature(secret, id)) ? id : null;
}

/**
 * Canonicalises an IP for comparison. On IPv6 a device keeps rotating addresses inside the same /64
 * (privacy extensions), so only the first 64 bits are used. IPv4-mapped IPv6 addresses
 * (::ffff:1.2.3.4) count as IPv4. Invalid input is returned unchanged.
 */
export function normalizeIp(ip: string): string {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
    if (mapped?.[1] && net.isIPv4(mapped[1])) return mapped[1];
    if (!net.isIPv6(ip)) return ip;

    let text = ip.toLowerCase().split('%')[0] ?? ip;
    // A trailing embedded IPv4 (a:b::1.2.3.4) is converted to two 16-bit groups.
    const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
    if (v4) {
        const [, a = 0, b = 0, c = 0, d = 0] = v4.map(Number) as number[];
        text = text.slice(0, v4.index) + ((Number(a) << 8) | Number(b)).toString(16) + ':' + ((Number(c) << 8) | Number(d)).toString(16);
    }
    const [head = '', tail] = text.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail === undefined ? [] : tail ? tail.split(':') : [];
    const fill = tail === undefined ? 0 : 8 - headParts.length - tailParts.length;
    const groups = [...headParts, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tailParts].map((g) => g.padStart(4, '0'));
    // ::/64 is not a real customer block (::1, ::ffff:a:b ...): keep those from collapsing into one bucket.
    if (groups.slice(0, 4).every((g) => g === '0000')) {
        if (groups[4] === '0000' && groups[5] === 'ffff' && groups[6] && groups[7]) {
            const hi = Number.parseInt(groups[6], 16);
            const lo = Number.parseInt(groups[7], 16);
            return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
        }
        return groups.join(':');
    }
    return groups.slice(0, 4).join(':') + '::/64';
}
