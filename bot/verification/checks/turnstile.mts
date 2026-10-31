import { block, review } from '../types.mts';
import type { Signal } from '../types.mts';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
    success: boolean;
    errorCodes: string[];
    hostname?: string | undefined;
    action?: string | undefined;
    cdata?: string | undefined;
    /** Cloudflare was unreachable or the response was unintelligible (not the user's fault). */
    unavailable?: boolean | undefined;
}

export interface TurnstileRequest {
    token: string;
    secret: string;
    ip?: string | undefined;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

/** The captcha is verified server-side; the client's claim that it passed is never trusted. */
export async function verifyTurnstile(request: TurnstileRequest): Promise<TurnstileResult> {
    const doFetch = request.fetchImpl ?? fetch;
    const body = new URLSearchParams({ secret: request.secret, response: request.token });
    if (request.ip) body.set('remoteip', request.ip);

    try {
        const response = await doFetch(SITEVERIFY_URL, {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(request.timeoutMs ?? 4000),
        });
        if (!response.ok) return { success: false, errorCodes: [`http-${response.status}`], unavailable: true };

        const data = (await response.json()) as Record<string, unknown>;
        const errorCodes = Array.isArray(data['error-codes']) ? data['error-codes'].map(String) : [];
        return {
            success: data['success'] === true,
            errorCodes,
            hostname: typeof data['hostname'] === 'string' ? data['hostname'] : undefined,
            action: typeof data['action'] === 'string' ? data['action'] : undefined,
            cdata: typeof data['cdata'] === 'string' ? data['cdata'] : undefined,
            // A bad secret key or a Cloudflare-side problem must not be blamed on the user either.
            unavailable: errorCodes.includes('internal-error') || errorCodes.includes('invalid-input-secret'),
        };
    } catch (error) {
        return { success: false, errorCodes: [error instanceof Error ? error.name : 'network-error'], unavailable: true };
    }
}

export interface TurnstileExpectation {
    action: string;
    /** Session id, so one session's token cannot be replayed in another. */
    cdata: string;
    hostnames: string[];
    /** Cloudflare test key: action/cdata/hostname are not echoed, so the match check is skipped (local testing only). */
    testKeys?: boolean;
}

export function turnstileSignals(result: TurnstileResult, expected: TurnstileExpectation): Signal[] {
    // If Cloudflare is unreachable we do not blame anyone, but we do not auto-approve either.
    if (result.unavailable) return [review('TURNSTILE_UNAVAILABLE', result.errorCodes.join(','))];

    if (!result.success) return [block('TURNSTILE_FAILED', result.errorCodes.join(',') || 'failed')];
    if (expected.testKeys) return [];

    const problems: string[] = [];
    if (result.action !== expected.action) problems.push(`action=${result.action ?? 'none'}`);
    if (result.cdata !== expected.cdata) problems.push('cdata mismatch');
    if (!result.hostname || !expected.hostnames.includes(result.hostname)) {
        problems.push(`hostname=${result.hostname ?? 'none'}`);
    }
    return problems.length > 0 ? [block('TURNSTILE_MISMATCH', problems.join('; '))] : [];
}
