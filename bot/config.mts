import 'dotenv/config';

// An empty setting falls back to its default (so "" is not turned into 0 and does not zero a limit);
// a non-numeric value stays NaN and validate() stops the bot at startup.
function envNumber(name: string, fallback: number): number {
    const raw = String(process.env[name] ?? '').trim();
    return raw === '' ? fallback : Number(raw);
}

const list = (value: string | undefined): string[] =>
    (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const DEFAULT_EMBED_COLOR = 0x23a55a;

function parseColor(raw: string | undefined): number {
    const value = String(raw ?? '').trim().replace(/^#/, '');
    return /^[0-9a-fA-F]{6}$/.test(value) ? parseInt(value, 16) : DEFAULT_EMBED_COLOR;
}

/** "TR:tr" → { country: 'TR', language: 'tr' }; empty or malformed disables the check. */
function parseLocaleHint(raw: string | undefined): { country: string; language: string } | undefined {
    const match = /^([A-Za-z]{2}):([A-Za-z]{2,3})$/.exec((raw ?? '').trim());
    return match ? { country: match[1]!.toUpperCase(), language: match[2]!.toLowerCase() } : undefined;
}

// Discord IDs are snowflakes: digits only, 17-20 of them.
const SNOWFLAKE = /^\d{17,20}$/;

const turnstileTestKeys = process.env['TURNSTILE_TEST_KEYS'] === '1';

export const config = {
    token: process.env['TOKEN'] ?? '',
    clientId: process.env['CLIENT_ID'] ?? '',
    guildId: process.env['GUILD_ID'] ?? '',
    staffRoleIds: list(process.env['STAFF_ROLE_IDS']),
    verifiedRoleId: process.env['VERIFIED_ROLE_ID'],
    unverifiedRoleId: process.env['UNVERIFIED_ROLE_ID'],
    verifyLogChannelId: process.env['VERIFY_LOG_CHANNEL_ID'],
    verifyReviewChannelId: process.env['VERIFY_REVIEW_CHANNEL_ID'],
    joinLogChannelId: process.env['JOIN_LOG_CHANNEL_ID'],
    brandName: (process.env['BRAND_NAME'] ?? '').trim() || 'Zack Verify',
    embedColor: parseColor(process.env['EMBED_COLOR']),

    verifyWebUrl: process.env['VERIFY_WEB_URL'] ?? '',
    apiPort: envNumber('API_PORT', 8787),
    apiHost: (process.env['API_HOST'] ?? '').trim() || '127.0.0.1',
    apiSecret: process.env['API_SECRET'] ?? '',
    hashPepper: process.env['HASH_PEPPER'] ?? '',
    deviceSecret: process.env['DEVICE_SECRET'] ?? '',
    // Local testing only: Cloudflare's official "always passes" test secret; action/cdata/hostname matching is skipped.
    // The bot refuses to start with it when NODE_ENV=production.
    turnstileTestKeys,
    turnstileSecret: turnstileTestKeys ? '1x0000000000000000000000000000000AA' : (process.env['TURNSTILE_SECRET'] ?? ''),
    // Comma-separated hostnames Turnstile must report (e.g. "verify.example.com").
    turnstileHostnames: list(process.env['TURNSTILE_HOSTNAMES']),
    proxycheckKey: process.env['PROXYCHECK_KEY'] || undefined,
    ipCheckFailMode: (['open', 'review', 'closed'] as const).find((m) => m === process.env['IP_CHECK_FAIL_MODE']) ?? 'review',
    minAccountAgeDays: envNumber('MIN_ACCOUNT_AGE_DAYS', 7),
    riskReviewThreshold: envNumber('RISK_REVIEW_THRESHOLD', 40),
    riskBlockThreshold: envNumber('RISK_BLOCK_THRESHOLD', 80),
    retryPerHour: envNumber('RETRY_PER_HOUR', 3),
    retryPerDay: envNumber('RETRY_PER_DAY', 6),
    raidWindowSec: envNumber('RAID_WINDOW_SEC', 60),
    raidJoinCount: envNumber('RAID_JOIN_COUNT', 10),
    raidCalmMin: envNumber('RAID_CALM_MIN', 15),
    localeHint: parseLocaleHint(process.env['LOCALE_HINT']),
};

export type Config = typeof config;

/**
 * A missing or wrong setting must not make the bot silently misbehave: stop at startup with a clear message.
 * With no argument (bot startup) everything is checked; command registration only checks the given keys.
 */
export function validate(required?: (keyof Config)[]): void {
    const full = required === undefined;
    const keys = required ?? (['token', 'clientId', 'guildId'] as (keyof Config)[]);
    const problems: string[] = [];

    const envName = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
    for (const key of keys) {
        const value = config[key];
        if (!value) problems.push(`${envName(key)} is not set (.env).`);
        else if (key !== 'token' && key.endsWith('Id') && !SNOWFLAKE.test(String(value))) {
            problems.push(`${envName(key)} is not a valid Discord ID: "${String(value)}"`);
        }
    }

    if (full) {
        for (const [name, value] of Object.entries({
            VERIFIED_ROLE_ID: config.verifiedRoleId,
            UNVERIFIED_ROLE_ID: config.unverifiedRoleId,
            VERIFY_LOG_CHANNEL_ID: config.verifyLogChannelId,
        })) {
            if (!value) problems.push(`${name} is not set (.env).`);
        }
        for (const [name, value] of Object.entries({
            VERIFIED_ROLE_ID: config.verifiedRoleId,
            UNVERIFIED_ROLE_ID: config.unverifiedRoleId,
            VERIFY_LOG_CHANNEL_ID: config.verifyLogChannelId,
            VERIFY_REVIEW_CHANNEL_ID: config.verifyReviewChannelId,
            JOIN_LOG_CHANNEL_ID: config.joinLogChannelId,
        })) {
            if (value && !SNOWFLAKE.test(value)) problems.push(`${name} is not a valid Discord ID: "${value}"`);
        }
        for (const id of config.staffRoleIds) {
            if (!SNOWFLAKE.test(id)) problems.push(`STAFF_ROLE_IDS contains an invalid ID: "${id}"`);
        }

        for (const [name, value] of Object.entries({
            API_SECRET: config.apiSecret, HASH_PEPPER: config.hashPepper, DEVICE_SECRET: config.deviceSecret,
        })) {
            if (value.length < 32) problems.push(`${name} must be at least 32 characters.`);
        }
        if (!config.turnstileSecret) problems.push('TURNSTILE_SECRET is not set.');
        if (config.turnstileTestKeys && process.env['NODE_ENV'] === 'production') {
            problems.push('TURNSTILE_TEST_KEYS cannot be used with NODE_ENV=production (the robot check would be disabled).');
        }
        if (config.turnstileHostnames.length === 0 && !config.turnstileTestKeys) problems.push('TURNSTILE_HOSTNAMES is not set.');
        if (!config.verifyWebUrl) problems.push('VERIFY_WEB_URL is not set.');

        const ranges = {
            apiPort: [1, 65535, 'API_PORT'],
            minAccountAgeDays: [0, 3650, 'MIN_ACCOUNT_AGE_DAYS'],
            riskReviewThreshold: [1, 1000, 'RISK_REVIEW_THRESHOLD'],
            riskBlockThreshold: [1, 1000, 'RISK_BLOCK_THRESHOLD'],
            retryPerHour: [1, 1000, 'RETRY_PER_HOUR'],
            retryPerDay: [1, 10000, 'RETRY_PER_DAY'],
            raidWindowSec: [1, 86400, 'RAID_WINDOW_SEC'],
            raidJoinCount: [1, 100000, 'RAID_JOIN_COUNT'],
            raidCalmMin: [1, 10080, 'RAID_CALM_MIN'],
        } as const;
        for (const [key, [min, max, env]] of Object.entries(ranges) as [keyof typeof ranges, readonly [number, number, string]][]) {
            const value = config[key];
            if (!Number.isFinite(value) || value < min || value > max) {
                problems.push(`${env} must be a number between ${min} and ${max} (currently: "${process.env[env]}").`);
            }
        }
        if (!(config.riskReviewThreshold < config.riskBlockThreshold)) {
            problems.push('RISK_REVIEW_THRESHOLD must be lower than RISK_BLOCK_THRESHOLD.');
        }
        if (!(config.retryPerHour <= config.retryPerDay)) problems.push('RETRY_PER_HOUR cannot exceed RETRY_PER_DAY.');
    }

    if (problems.length > 0) {
        console.error('❌ Configuration error:\n   • ' + problems.join('\n   • '));
        process.exit(1);
    }
}
