import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// A strict Content Security Policy (CSP) with a one-time nonce for every request.
// Next.js reads the nonce from the CSP in the request header and adds it to its own scripts.
export function proxy(request: NextRequest) {
    const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    const dev = process.env.NODE_ENV !== 'production';

    const csp = [
        `default-src 'self'`,
        // 'strict-dynamic': scripts loaded by the nonced script (Turnstile) are trusted.
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${dev ? " 'unsafe-eval'" : ''}`,
        `style-src 'self' 'unsafe-inline'`,
        `img-src 'self' data: blob: https://cdn.discordapp.com https://media.discordapp.net`,
        `font-src 'self'`,
        `connect-src 'self' https://challenges.cloudflare.com${dev ? ' ws:' : ''}`,
        `frame-src https://challenges.cloudflare.com`,
        `object-src 'none'`,
        `base-uri 'self'`,
        `form-action 'self'`,
        `frame-ancestors 'none'`,
        // HTTPS addresses only: must not break sub-resources during local http testing.
        ...(process.env['APP_URL']?.startsWith('https://') ? ['upgrade-insecure-requests'] : []),
    ].join('; ');

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set('content-security-policy', csp);

    return response;
}

export const config = {
    matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
