// Environment variables are read lazily: a missing one gives a clear error where it is first used.

function read(name: string, min = 1): string {
    const value = process.env[name];
    if (!value || value.length < min) {
        throw new Error(`${name} is not set${min > 1 ? ` (at least ${min} characters)` : ''}.`);
    }
    return value;
}

const production = (): boolean => process.env['NODE_ENV'] === 'production';

/**
 * The fake Discord used by end-to-end tests is only used when explicitly requested. In production it is refused:
 * redirecting OAuth to another host would let an attacker who can set variables steal sign-ins.
 */
const mockDiscord = (): boolean => {
    const requested = process.env['E2E_MOCK_DISCORD'] === '1';
    if (requested && production()) throw new Error('E2E_MOCK_DISCORD must not be set in production.');
    return requested;
};

/** In production the bot must be reached over TLS: the signed requests carry personal data (IP address, Discord id). */
function botUrl(): string {
    const value = read('BOT_API_URL').replace(/\/+$/, '');
    const url = new URL(value);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (production() && url.protocol !== 'https:' && !local) throw new Error('BOT_API_URL must use https:// in production.');
    return value;
}

export const env = {
    get appUrl(): string { return read('APP_URL').replace(/\/+$/, ''); },
    get appOrigin(): string { return new URL(read('APP_URL')).origin; },
    get siteName(): string { return process.env['SITE_NAME'] || 'Zack Verify'; },
    /** Optional contact shown in the privacy notice (e.g. an email or "the #support channel"). */
    get privacyContact(): string { return process.env['PRIVACY_CONTACT'] || 'the server staff, through the support channel in the Discord server'; },
    get clientId(): string { return read('DISCORD_CLIENT_ID'); },
    get clientSecret(): string { return read('DISCORD_CLIENT_SECRET'); },
    get guildId(): string { return read('DISCORD_GUILD_ID'); },
    get botApiUrl(): string { return botUrl(); },
    get apiSecret(): string { return read('API_SECRET', 32); },
    get sessionSecret(): string { return read('SESSION_SECRET', 32); },
    get turnstileSiteKey(): string { return read('NEXT_PUBLIC_TURNSTILE_SITE_KEY'); },
    get discordApiBase(): string {
        return (mockDiscord() && process.env['DISCORD_API_BASE']) || 'https://discord.com/api/v10';
    },
    get discordAuthorizeUrl(): string {
        return (mockDiscord() && process.env['DISCORD_AUTHORIZE_URL']) || 'https://discord.com/oauth2/authorize';
    },
    get secureCookies(): boolean { return new URL(read('APP_URL')).protocol === 'https:'; },
};
