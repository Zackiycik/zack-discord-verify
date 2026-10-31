import { LIMITS, WEIGHTS } from '../weights.mts';
import { score } from '../types.mts';
import type { Signal } from '../types.mts';

/** Headless/automation hints collected in the browser. All of them can be faked, so they only add score. */
export interface HeadlessFlags {
    webdriver: boolean;
    headlessUa: boolean;
    chromeObjectMissing: boolean;
    zeroOuterSize: boolean;
    pluginsEmpty: boolean;
    swiftShader: boolean;
    languagesEmpty: boolean;
}

export interface InteractionCounts {
    pointer: number;
    touch: number;
    key: number;
    focus: number;
}

export interface BehaviorInput {
    /** Time on the page, measured by the SERVER (challenge viewed → submit). null if never viewed. */
    elapsedMs: number | null;
    interactions: InteractionCounts;
    headless: HeadlessFlags;
}

export function behaviorSignals(input: BehaviorInput): Signal[] {
    const signals: Signal[] = [];

    if (input.elapsedMs === null || input.elapsedMs < LIMITS.MIN_DWELL_MS) {
        signals.push(
            score('FAST_SUBMIT', WEIGHTS.FAST_SUBMIT, input.elapsedMs === null ? 'page was never opened' : `${input.elapsedMs} ms`),
        );
    }

    const { pointer, touch, key } = input.interactions;
    if (pointer + touch + key === 0) signals.push(score('NO_INTERACTION', WEIGHTS.NO_INTERACTION));

    const raised = Object.entries(input.headless)
        .filter(([, value]) => value)
        .map(([name]) => name);
    if (raised.length > 0) {
        const counted = Math.min(raised.length, WEIGHTS.HEADLESS_MAX_COUNT);
        signals.push(score('HEADLESS', counted * WEIGHTS.HEADLESS_EACH, raised.join(',')));
    }

    return signals;
}
