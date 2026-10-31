import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { botCall } from '@/lib/botClient';
import { COOKIES, TTL, cookieOptions, expiredCookie } from '@/lib/cookies';
import { clientNetwork } from '@/lib/net';
import { isSameOrigin } from '@/lib/origin';

export const dynamic = 'force-dynamic';

const MAX_BODY = 16 * 1024;

type SubmitResult =
    | { status: 'invalid_session' }
    | { status: 'done'; deviceToken: string; resultToken: string };

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ ok: false, error, ...extra }, { status });

/** Raw signals from the client; identity, IP and session are added on the server, never left to the client. */
export async function POST(request: Request): Promise<NextResponse> {
    if (!isSameOrigin(request)) return fail(403, 'forbidden');

    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail(413, 'too_large');
    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return fail(400, 'bad_request');
    }

    const jar = await cookies();
    const sessionToken = jar.get(COOKIES.session)?.value;
    if (!sessionToken) return fail(410, 'expired');

    // Device token: the httpOnly cookie first, else the one from localStorage; the bot verifies the signature.
    const deviceCookie = jar.get(COOKIES.device)?.value;
    const deviceBody = typeof body['deviceToken'] === 'string' ? body['deviceToken'] : null;

    // Only the expected fields are forwarded; IP and location come from the headers.
    const result = await botCall<SubmitResult>('/v1/verify/submit', {
        sessionToken,
        turnstileToken: body['turnstileToken'],
        deviceToken: deviceCookie ?? deviceBody,
        fingerprint: body['fingerprint'],
        clientTz: body['clientTz'] ?? null,
        clientLangs: body['clientLangs'],
        interactions: body['interactions'],
        headless: body['headless'],
        ...clientNetwork(request.headers),
    });

    if (!result.ok) {
        if (result.error === 'unreachable') return fail(503, 'maintenance');
        if (result.error === 'rate_limited') return fail(429, 'rate_limited', { retryAfterSec: result.retryAfterSec ?? 60 });
        return fail(400, 'bad_request');
    }

    if (result.data.status === 'invalid_session') {
        const response = fail(410, 'expired');
        response.cookies.set(COOKIES.session, '', expiredCookie());
        return response;
    }

    // The decision is neither made nor shown here: the result page reads it from the bot.
    const response = NextResponse.json({ ok: true, deviceToken: result.data.deviceToken });
    response.cookies.set(COOKIES.device, result.data.deviceToken, cookieOptions(TTL.device));
    response.cookies.set(COOKIES.result, result.data.resultToken, cookieOptions(TTL.result));
    // The session was single use and is consumed: the cookie is deleted too.
    response.cookies.set(COOKIES.session, '', expiredCookie());
    return response;
}
