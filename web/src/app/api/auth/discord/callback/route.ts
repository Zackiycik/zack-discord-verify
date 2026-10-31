import { NextResponse } from 'next/server';
import { botCall } from '@/lib/botClient';
import { COOKIES, TTL, cookieOptions, expiredCookie } from '@/lib/cookies';
import { exchangeCode, fetchUser, revokeToken } from '@/lib/discord';
import { env } from '@/lib/env';
import { clientNetwork } from '@/lib/net';
import { STATE_COOKIE, verifyState } from '@/lib/state';

export const dynamic = 'force-dynamic';

type CreateResult =
    | { status: 'ok'; sessionToken: string }
    | { status: 'already_verified'; rolesOk: boolean }
    | { status: 'not_member' }
    | { status: 'bot' }
    | { status: 'rate_limited'; retryAfterSec: number };

const go = (path: string) => {
    const response = NextResponse.redirect(`${env.appUrl}${path}`, 302);
    // The state cookie is single use: it is deleted whatever the outcome.
    response.cookies.set(STATE_COOKIE, '', expiredCookie());
    return response;
};

const fail = (code: string) => go(`/verify?e=${code}`);

export async function GET(request: Request): Promise<NextResponse> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const stateCookie = request.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${STATE_COOKIE}=([^;]+)`))?.[1];

    if (url.searchParams.get('error')) return fail('oauth'); // the user declined on Discord

    // CSRF: the state must be in both the cookie and the URL, and its signature must be valid.
    if (!verifyState(env.sessionSecret, stateCookie, url.searchParams.get('state'))) return fail('state');
    if (!code) return fail('oauth');

    const accessToken = await exchangeCode(code);
    if (!accessToken) return fail('oauth');

    const user = await fetchUser(accessToken);
    // The token is no longer needed: revoke it immediately and never store it anywhere.
    await revokeToken(accessToken);
    if (!user) return fail('oauth');

    const created = await botCall<CreateResult>('/v1/session/create', { user, ...clientNetwork(request.headers) });

    if (!created.ok) {
        if (created.error === 'unreachable') return go('/verify/result?s=maintenance');
        if (created.error === 'rate_limited') {
            return go(`/verify/result?s=rate&m=${Math.max(1, Math.ceil((created.retryAfterSec ?? 60) / 60))}`);
        }
        return fail('oauth');
    }

    switch (created.data.status) {
        case 'ok': {
            const response = go('/verify/challenge');
            response.cookies.set(COOKIES.session, created.data.sessionToken, cookieOptions(TTL.session));
            return response;
        }
        case 'already_verified':
            return go(created.data.rolesOk ? '/verify/result?s=already' : '/verify/result?s=role_failed');
        case 'not_member':
            return go('/verify/result?s=not_member');
        case 'bot':
            return go('/verify/result?s=bot');
        case 'rate_limited':
            return go(`/verify/result?s=rate&m=${Math.max(1, Math.ceil(created.data.retryAfterSec / 60))}`);
    }
}
