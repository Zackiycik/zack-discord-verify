import type { Decision, Signal } from './types.mts';

export interface EngineOptions {
    reviewThreshold: number;
    blockThreshold: number;
    /** In raid mode nobody is auto-approved (anything not blocked goes to manual review). */
    raidMode?: boolean;
}

export interface Verdict {
    decision: Decision;
    score: number;
    /** Signal codes that contributed to the decision (sent to the staff log). */
    reasons: string[];
    signals: Signal[];
}

// Order matters: hard blocks first, then high score, then manual review, approval last.
// (If review were checked before the block threshold, the block threshold could never be reached.)
export function decide(signals: Signal[], options: EngineOptions): Verdict {
    const score = signals.reduce((sum, s) => (s.kind === 'SCORE' ? sum + s.points : sum), 0);
    const reasons = signals.map((s) => s.code);

    const has = (kind: Signal['kind']) => signals.some((s) => s.kind === kind);

    let decision: Decision;
    if (has('BLOCK')) {
        decision = 'blocked';
    } else if (score >= options.blockThreshold) {
        decision = 'blocked';
    } else if (has('REVIEW') || score >= options.reviewThreshold) {
        decision = 'manual_review';
    } else if (options.raidMode) {
        decision = 'manual_review';
        reasons.push('RAID_MODE');
    } else {
        decision = 'approved';
    }

    return { decision, score, reasons, signals };
}
