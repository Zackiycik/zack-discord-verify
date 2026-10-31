import { env } from './env';

export interface DiscordUser {
    id: string;
    username: string;
    global_name: string | null;
    avatar: string | null;
    public_flags: number;
    bot: boolean;
    system: boolean;
}

const TIMEOUT_MS = 8000;

export function authorizeUrl(state: string): string {
    const url = new URL(env.discordAuthorizeUrl);
    url.searchParams.set('client_id', env.clientId);
    url.searchParams.set('redirect_uri', `${env.appUrl}/api/auth/discord/callback`);
    url.searchParams.set('response_type', 'code');
    // Identity only: no email, server list or any other permission is requested.
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');
    return url.toString();
}

export async function exchangeCode(code: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
    try {
        const response = await fetchImpl(`${env.discordApiBase}/oauth2/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: env.clientId,
                client_secret: env.clientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${env.appUrl}/api/auth/discord/callback`,
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const json = (await response.json()) as { access_token?: unknown };
        return typeof json.access_token === 'string' ? json.access_token : null;
    } catch {
        return null;
    }
}

/** Only the fields the bot expects are taken from Discord's response (unknown fields are rejected by the bot). */
export async function fetchUser(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<DiscordUser | null> {
    try {
        const response = await fetchImpl(`${env.discordApiBase}/users/@me`, {
            headers: { authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const u = (await response.json()) as Record<string, unknown>;
        if (typeof u['id'] !== 'string' || typeof u['username'] !== 'string') return null;
        return {
            id: u['id'],
            username: u['username'],
            global_name: typeof u['global_name'] === 'string' ? u['global_name'] : null,
            avatar: typeof u['avatar'] === 'string' ? u['avatar'] : null,
            public_flags: typeof u['public_flags'] === 'number' ? u['public_flags'] : 0,
            bot: u['bot'] === true,
            system: u['system'] === true,
        };
    } catch {
        return null;
    }
}

/** The access token is revoked as soon as we are done and is never stored. A failure does not break the flow. */
export async function revokeToken(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
    try {
        await fetchImpl(`${env.discordApiBase}/oauth2/token/revoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: env.clientId,
                client_secret: env.clientSecret,
                token: accessToken,
                token_type_hint: 'access_token',
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        // if revocation fails the token is short-lived anyway and only has the 'identify' scope
    }
}
