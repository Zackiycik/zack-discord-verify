import { WEIGHTS } from '../weights.mts';
import { score } from '../types.mts';
import type { Signal } from '../types.mts';

/**
 * UTC offset of a timezone in minutes. Aliases such as "Europe/Istanbul" and "Asia/Istanbul" give the
 * same offset, so offsets are compared rather than names. Returns NaN for an invalid timezone.
 */
export function utcOffsetMinutes(timeZone: string, at: number): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(
            new Date(at),
        );
        const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
        if (name === 'GMT') return 0;
        const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
        if (!match) return Number.NaN;
        const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
        return match[1] === '-' ? -minutes : minutes;
    } catch {
        return Number.NaN;
    }
}

export interface LocaleInput {
    clientTz: string | null;
    /** Timezone derived from the IP (Vercel `x-vercel-ip-timezone`). null if unknown. */
    ipTz: string | null;
    clientLangs: string[];
    ipCountry: string | null;
    now: number;
    /**
     * Optional "expected browser language" rule, e.g. { country: 'TR', language: 'tr' }: a visitor whose IP is in
     * that country but whose browser lists no matching language is slightly suspicious. Omit to disable.
     */
    hint?: { country: string; language: string } | undefined;
}

// Never a reason to block on its own: it only adds score.
export function localeSignals(input: LocaleInput): Signal[] {
    const signals: Signal[] = [];

    const clientOffset = input.clientTz ? utcOffsetMinutes(input.clientTz, input.now) : Number.NaN;
    if (Number.isNaN(clientOffset)) {
        signals.push(score('TZ_MISSING', WEIGHTS.TZ_MISSING, input.clientTz ?? 'none'));
    } else if (input.ipTz) {
        const ipOffset = utcOffsetMinutes(input.ipTz, input.now);
        if (!Number.isNaN(ipOffset) && ipOffset !== clientOffset) {
            signals.push(score('TZ_MISMATCH', WEIGHTS.TZ_MISMATCH, `browser ${input.clientTz}, IP ${input.ipTz}`));
        }
    }

    const { hint } = input;
    if (hint && input.ipCountry === hint.country && input.clientLangs.length > 0) {
        const matches = input.clientLangs.some((lang) => lang.toLowerCase().startsWith(hint.language));
        if (!matches) signals.push(score('LANG_MISMATCH', WEIGHTS.LANG_MISMATCH, input.clientLangs.join(',')));
    }

    return signals;
}
