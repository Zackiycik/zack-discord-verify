export interface RaidSnapshot {
    active: boolean;
    manual: boolean;
    since: number;
    lastTrigger: number;
}

export interface RaidOptions {
    windowMs: number;
    joinCount: number;
    calmMs: number;
    now?: () => number;
    /** Persisted state, so raid mode survives a bot restart. */
    load?: () => RaidSnapshot | null;
    save?: (snapshot: RaidSnapshot) => void;
    /** Called when the mode switches on/off (used to log to the staff channel). */
    onChange?: (active: boolean, info: { by: 'auto' | 'manual'; joins: number; staffId?: string | undefined }) => void;
}

/**
 * Raid mode kicks in when many members join in a short time. Automatic mode switches itself
 * off after `calmMs` without a trigger; manually enabled mode stays on until staff disable it.
 */
export class RaidMonitor {
    private readonly joins: number[] = [];
    private state: RaidSnapshot = { active: false, manual: false, since: 0, lastTrigger: 0 };
    private readonly options: RaidOptions;
    private readonly clock: () => number;

    constructor(options: RaidOptions) {
        this.options = options;
        this.clock = options.now ?? Date.now;
        const saved = options.load?.();
        if (saved) this.state = { ...saved };
    }

    private persist(): void {
        this.options.save?.({ ...this.state });
    }

    private trim(now: number): void {
        const cutoff = now - this.options.windowMs;
        while (this.joins.length > 0 && (this.joins[0] ?? 0) <= cutoff) this.joins.shift();
    }

    /** Call on every new member join. */
    recordJoin(): void {
        const now = this.clock();
        this.joins.push(now);
        this.trim(now);

        if (this.joins.length < this.options.joinCount) return;
        this.state.lastTrigger = now;
        if (!this.state.active) {
            this.state = { active: true, manual: false, since: now, lastTrigger: now };
            this.options.onChange?.(true, { by: 'auto', joins: this.joins.length });
        }
        this.persist();
    }

    /** Switches automatic mode off once the calm period has passed. */
    isActive(): boolean {
        if (this.state.active && !this.state.manual && this.clock() - this.state.lastTrigger >= this.options.calmMs) {
            this.state = { active: false, manual: false, since: 0, lastTrigger: 0 };
            this.persist();
            this.options.onChange?.(false, { by: 'auto', joins: 0 });
        }
        return this.state.active;
    }

    enable(staffId?: string): void {
        const now = this.clock();
        const wasActive = this.state.active;
        this.state = { active: true, manual: true, since: wasActive ? this.state.since : now, lastTrigger: now };
        this.persist();
        if (!wasActive) this.options.onChange?.(true, { by: 'manual', joins: this.joins.length, staffId });
    }

    disable(staffId?: string): void {
        const wasActive = this.state.active;
        this.state = { active: false, manual: false, since: 0, lastTrigger: 0 };
        this.persist();
        if (wasActive) this.options.onChange?.(false, { by: 'manual', joins: this.joins.length, staffId });
    }

    status() {
        this.trim(this.clock());
        const { active, manual, since } = this.state;
        return {
            active: this.isActive(),
            manual,
            since,
            joinsInWindow: this.joins.length,
            joinCount: this.options.joinCount,
            windowSec: Math.round(this.options.windowMs / 1000),
            calmMin: Math.round(this.options.calmMs / 60_000),
            wasActive: active,
        };
    }
}
