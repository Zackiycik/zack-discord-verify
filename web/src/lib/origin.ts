import { env } from './env';

/**
 * Verifies that state-changing POST requests come from our own site (CSRF).
 * Browsers always send the Origin header on these requests; without it the request is rejected.
 */
export function isSameOrigin(request: Request): boolean {
    const origin = request.headers.get('origin');
    return origin !== null && origin === env.appOrigin;
}
