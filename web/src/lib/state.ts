import { createHmac } from 'node:crypto';
import { randomString, safeEqual } from './hmac';

// OAuth "state", against CSRF. A random value is sent to Discord and written to a signed cookie;
// if the two do not match on return (or the cookie is missing/forged) the sign-in is rejected.

export const STATE_COOKIE = 'oauth_state';
export const STATE_TTL_SECONDS = 10 * 60;

const sign = (secret: string, state: string): string =>
    createHmac('sha256', secret).update(`oauth-state:${state}`).digest('base64url');

export function createState(secret: string): { state: string; cookieValue: string } {
    const state = randomString(24);
    return { state, cookieValue: `${state}.${sign(secret, state)}` };
}

export function verifyState(secret: string, cookieValue: string | undefined, queryState: string | null): boolean {
    if (!cookieValue || !queryState) return false;
    const dot = cookieValue.lastIndexOf('.');
    if (dot < 1) return false;
    const state = cookieValue.slice(0, dot);
    const signature = cookieValue.slice(dot + 1);
    return safeEqual(signature, sign(secret, state)) && safeEqual(state, queryState);
}
