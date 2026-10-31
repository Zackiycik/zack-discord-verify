import { NextResponse } from 'next/server';
import { cookieOptions } from '@/lib/cookies';
import { authorizeUrl } from '@/lib/discord';
import { env } from '@/lib/env';
import { STATE_COOKIE, STATE_TTL_SECONDS, createState } from '@/lib/state';

export const dynamic = 'force-dynamic';

const back = (error: string) => NextResponse.redirect(`${env.appUrl}/verify?e=${error}`, 302);

export function GET(request: Request): NextResponse {
    const url = new URL(request.url);

    // Without consent we do not go to Discord (server-side counterpart of the checkbox on the page).
    if (url.searchParams.get('consent') !== '1') return back('consent');

    // Every sign-in gets a fresh, signed CSRF state written to a cookie.
    const { state, cookieValue } = createState(env.sessionSecret);
    const response = NextResponse.redirect(authorizeUrl(state), 302);
    response.cookies.set(STATE_COOKIE, cookieValue, cookieOptions(STATE_TTL_SECONDS));
    return response;
}
