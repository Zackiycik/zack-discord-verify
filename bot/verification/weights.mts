// Scores and fixed limits in one place. The review/block thresholds come from env;
// changing the weights below requires a code change.

export const WEIGHTS = {
    ACCOUNT_YOUNG: 20, // account younger than YOUNG_ACCOUNT_DAYS
    NO_AVATAR: 10,
    NO_GLOBAL_NAME: 5,
    IP_HIGH_RISK: 20, // proxycheck risk >= IP_RISK_THRESHOLD
    TZ_MISMATCH: 15,
    TZ_MISSING: 10,
    LANG_MISMATCH: 5, // weak signal: many real users run an English browser
    FAST_SUBMIT: 25,
    NO_INTERACTION: 15,
    HEADLESS_EACH: 20,
    HEADLESS_MAX_COUNT: 2,
    STORAGE_CLEARED: 20, // no device token but a familiar fingerprint
    IP_CHECK_FAILED_OPEN: 10,
} as const;

export const LIMITS = {
    YOUNG_ACCOUNT_DAYS: 30,
    IP_RISK_THRESHOLD: 66,
    MIN_DWELL_MS: 4000, // shortest plausible time on the page (measured by the server)
    // If another account was verified from the same IP (IPv6: same /64) within this window, manual review is required.
    IP_SHARED_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
    SPAMMER_FLAG: 1 << 20, // one of Discord's undocumented public_flags bits
} as const;
