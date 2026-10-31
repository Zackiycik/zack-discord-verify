// Shared vocabulary of the verification checks. Every check returns zero or more Signals;
// the risk engine (engine.mts) turns them into a single decision.

/** BLOCK: blocks on its own. REVIEW: sends to manual review on its own. SCORE: adds points. */
export type SignalKind = 'BLOCK' | 'REVIEW' | 'SCORE';

export interface Signal {
    code: string;
    kind: SignalKind;
    points: number;
    /** Goes to the staff log only, never back to the user or the site. */
    detail?: string | undefined;
}

export type Decision = 'approved' | 'manual_review' | 'blocked';
export type IpFailMode = 'open' | 'review' | 'closed';

export const block = (code: string, detail?: string): Signal => ({ code, kind: 'BLOCK', points: 0, detail });
export const review = (code: string, detail?: string): Signal => ({ code, kind: 'REVIEW', points: 0, detail });
export const score = (code: string, points: number, detail?: string): Signal => ({
    code,
    kind: 'SCORE',
    points,
    detail,
});
