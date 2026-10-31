import { isIP } from 'node:net';

export interface ClientNetwork {
    ip: string;
    ipCountry: string | null;
    ipTimezone: string | null;
}

/**
 * Real IP and geolocation headers. Vercel writes these itself, a client cannot forge them.
 * (Behind an untrusted proxy outside Vercel they cannot be trusted.)
 * In development without the headers 127.0.0.1 is used; the bot does not look private addresses up.
 */
export function clientNetwork(headers: Headers): ClientNetwork {
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const candidate = headers.get('x-real-ip')?.trim() || forwarded || '';
    const ip = isIP(candidate) !== 0 ? candidate : '127.0.0.1';

    const country = headers.get('x-vercel-ip-country')?.trim().toUpperCase() ?? '';
    let timezone: string | null = null;
    const rawTimezone = headers.get('x-vercel-ip-timezone');
    if (rawTimezone) {
        try {
            timezone = decodeURIComponent(rawTimezone).slice(0, 64);
        } catch {
            timezone = null;
        }
    }

    return { ip, ipCountry: /^[A-Z]{2}$/.test(country) ? country : null, ipTimezone: timezone };
}
