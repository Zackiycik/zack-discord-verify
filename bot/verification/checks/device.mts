import { WEIGHTS } from '../weights.mts';
import { block, review, score } from '../types.mts';
import type { Signal } from '../types.mts';

/** Facts read from the database; "others" = other Discord accounts. */
export interface DeviceFacts {
    /** Is the device token sent by the client valid (correct signature)? */
    tokenValid: boolean;
    /** Other accounts previously verified with the same device token. */
    tokenOthers: number;
    /** Other accounts previously verified with the same fingerprint. */
    fingerprintOthers: number;
    /** Other accounts approved from the same IP (IPv6: same /64) within the last 7 days. */
    ipRecentOthers: number;
}

/**
 * The device token is minted and signed by the server and is hard to forge: a match is strong evidence (BLOCK).
 * The fingerprint is computed in the browser, can be forged and can false-positive: a match only sends to manual review.
 * The main evasion is clearing browser storage, so "no token but familiar fingerprint" adds score.
 */
export function deviceSignals(facts: DeviceFacts): Signal[] {
    const signals: Signal[] = [];

    if (facts.tokenOthers > 0) signals.push(block('DEVICE_TOKEN_REUSED', `${facts.tokenOthers} other account(s)`));

    if (facts.fingerprintOthers > 0) {
        signals.push(review('DEVICE_FP_MATCH', `${facts.fingerprintOthers} other account(s)`));
        if (!facts.tokenValid) signals.push(score('STORAGE_CLEARED', WEIGHTS.STORAGE_CLEARED));
    }

    // The IP is the only link that catches an alt account coming from another device/browser. Households and
    // mobile carriers (CGNAT) share IPs and can false-positive, so this asks for staff review instead of blocking.
    if (facts.ipRecentOthers > 0) signals.push(review('IP_SHARED', `${facts.ipRecentOthers} account(s)`));

    return signals;
}
