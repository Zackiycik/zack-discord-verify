import { accountAgeDays } from '../snowflake.mts';
import { LIMITS, WEIGHTS } from '../weights.mts';
import { review, score } from '../types.mts';
import type { Signal } from '../types.mts';

export interface AccountInfo {
    id: string;
    avatar: string | null;
    globalName: string | null;
    publicFlags: number;
}

export interface AccountOptions {
    now: number;
    minAgeDays: number;
}

export function accountSignals(account: AccountInfo, options: AccountOptions): Signal[] {
    const signals: Signal[] = [];
    const age = accountAgeDays(account.id, options.now);
    const ageText = `${age.toFixed(1)} days`;

    if (age < options.minAgeDays) signals.push(review('ACCOUNT_TOO_NEW', ageText));
    // An account younger than the minimum age goes to manual review and also gets the "young account" score.
    if (age < LIMITS.YOUNG_ACCOUNT_DAYS) signals.push(score('ACCOUNT_YOUNG', WEIGHTS.ACCOUNT_YOUNG, ageText));

    if (!account.avatar) signals.push(score('NO_AVATAR', WEIGHTS.NO_AVATAR));
    if (!account.globalName) signals.push(score('NO_GLOBAL_NAME', WEIGHTS.NO_GLOBAL_NAME));

    if ((account.publicFlags & LIMITS.SPAMMER_FLAG) !== 0) signals.push(review('ACCOUNT_SPAMMER_FLAG'));

    return signals;
}
