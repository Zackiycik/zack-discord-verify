import { env } from './env';

export const COOKIES = {
    session: 'vs', // session token, 10 min
    device: 'did', // device token, 1 year
    result: 'vr', // result token, 15 min
} as const;

export const TTL = {
    session: 10 * 60,
    result: 15 * 60,
    device: 365 * 24 * 60 * 60,
} as const;

/** All cookies are httpOnly + SameSite=Lax; additionally Secure on an HTTPS address. */
export function cookieOptions(maxAgeSeconds: number) {
    return { httpOnly: true, secure: env.secureCookies, sameSite: 'lax' as const, path: '/', maxAge: maxAgeSeconds };
}

export const expiredCookie = () => ({ ...cookieOptions(0), maxAge: 0 });
