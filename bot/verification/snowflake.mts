const DISCORD_EPOCH = 1420070400000n;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Extracts the account creation time (ms) from a Discord ID (snowflake). */
export function snowflakeToMs(id: string): number {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

export function accountAgeDays(id: string, now: number): number {
    return (now - snowflakeToMs(id)) / DAY_MS;
}
