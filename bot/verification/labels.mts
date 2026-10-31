import type { Signal } from './types.mts';

/** Human-readable signal descriptions for staff (the codes themselves stay stable in logs and tests). */
const SIGNAL_LABELS: Record<string, string> = {
    DEVICE_TOKEN_REUSED: 'Another account was verified from the same device',
    DEVICE_FP_MATCH: 'Browser fingerprint matches another account',
    DEVICE_RACE: 'Concurrent verification from the same device',
    FP_RACE: 'Concurrent verification with the same fingerprint',
    IP_SHARED: 'Another account was verified from the same IP recently',
    IP_PROXY: 'Uses a VPN / proxy',
    IP_HIGH_RISK: 'IP address is high risk',
    IP_CHECK_FAILED: 'IP check could not be performed',
    PREVIOUSLY_REJECTED: 'Previously rejected by staff',
    TURNSTILE_FAILED: 'Robot check failed',
    TURNSTILE_MISMATCH: 'Robot check does not belong to this session',
    TURNSTILE_UNAVAILABLE: 'Robot check could not be verified',
    ACCOUNT_TOO_NEW: 'Account is too new',
    ACCOUNT_YOUNG: 'Account is new',
    ACCOUNT_SPAMMER_FLAG: 'Flagged as a spammer by Discord',
    NO_AVATAR: 'No profile picture',
    NO_GLOBAL_NAME: 'No display name',
    TZ_MISMATCH: 'Timezone does not match the IP',
    TZ_MISSING: 'Timezone unavailable',
    LANG_MISMATCH: 'Browser language does not match the expected language',
    FAST_SUBMIT: 'Spent very little time on the page',
    NO_INTERACTION: 'No mouse, touch or keyboard input',
    HEADLESS: 'Signs of browser automation',
    STORAGE_CLEARED: 'Browser data looks cleared',
    RAID_MODE: 'Raid mode is active',
};

export const signalLabel = (code: string): string => SIGNAL_LABELS[code] ?? code;

/** One line: kind badge (BLOCK / REVIEW / +points) + description + optional detail. */
export function signalLine(s: Signal): string {
    const badge = s.kind === 'BLOCK' ? 'BLOCK' : s.kind === 'REVIEW' ? 'REVIEW' : `+${s.points}`;
    return `\`${badge}\`  ${signalLabel(s.code)}${s.detail ? ` - *${s.detail}*` : ''}`;
}
