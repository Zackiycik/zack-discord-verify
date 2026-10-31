import { env } from './env';
import { randomString, signRequest } from './hmac';

export type BotResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: 'unreachable' | 'unauthorized' | 'bad_request' | 'rate_limited' | 'internal' | string; status: number; retryAfterSec?: number };

const CALL_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 3000;

/** Sends a signed request to the bot. If the bot is down/unreachable it returns { error: 'unreachable' } and never throws. */
export async function botCall<T>(path: string, payload: unknown, fetchImpl: typeof fetch = fetch): Promise<BotResult<T>> {
    const body = JSON.stringify(payload);
    const ts = String(Date.now());
    const nonce = randomString(18);
    const signature = signRequest(env.apiSecret, { ts, nonce, method: 'POST', path, body });

    try {
        const response = await fetchImpl(`${env.botApiUrl}${path}`, {
            method: 'POST',
            body,
            headers: { 'content-type': 'application/json', 'x-ts': ts, 'x-nonce': nonce, 'x-signature': signature },
            signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            cache: 'no-store',
        });
        const json = (await response.json().catch(() => null)) as
            | { ok: true; data: T }
            | { ok: false; error?: string; retryAfterSec?: number }
            | null;

        if (response.ok && json && json.ok) return { ok: true, data: json.data };
        const failure = json && !json.ok ? json : null;
        return {
            ok: false,
            status: response.status,
            error: failure?.error ?? 'internal',
            ...(failure?.retryAfterSec ? { retryAfterSec: failure.retryAfterSec } : {}),
        };
    } catch {
        return { ok: false, status: 503, error: 'unreachable' };
    }
}

/** Is the bot up and connected to Discord? If not, the site shows the "maintenance" screen. */
export async function botHealthy(fetchImpl: typeof fetch = fetch): Promise<boolean> {
    try {
        const response = await fetchImpl(`${env.botApiUrl}/health`, {
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
            cache: 'no-store',
        });
        return response.ok;
    } catch {
        return false;
    }
}
