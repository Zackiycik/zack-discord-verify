import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RaidMonitor } from '../verification/raid.mts';
import type { RaidSnapshot } from '../verification/raid.mts';

const SEC = 1000;
const MIN = 60 * SEC;

function make() {
    const clock = { t: 1_800_000_000_000 };
    const changes: string[] = [];
    let saved: RaidSnapshot | null = null;
    const monitor = new RaidMonitor({
        windowMs: 60 * SEC, joinCount: 5, calmMs: 15 * MIN, now: () => clock.t,
        save: (s) => { saved = s; },
        load: () => saved,
        onChange: (active, info) => void changes.push(`${active ? 'on' : 'off'}:${info.by}`),
    });
    return { clock, changes, monitor, getSaved: () => saved };
}
const joins = (m: RaidMonitor, clock: { t: number }, n: number, gapMs = 1000) => {
    for (let i = 0; i < n; i++) { m.recordJoin(); clock.t += gapMs; }
};

test('stays off below the threshold and switches on automatically at it', () => {
    const { monitor, clock, changes } = make();
    joins(monitor, clock, 4);
    assert.equal(monitor.isActive(), false);
    joins(monitor, clock, 1);
    assert.equal(monitor.isActive(), true);
    assert.deepEqual(changes, ['on:auto']);
});

test('joins spread beyond the window do not trigger it', () => {
    const { monitor, clock } = make();
    joins(monitor, clock, 10, 20 * SEC);
    assert.equal(monitor.isActive(), false);
});

test('automatic mode switches itself off after the calm period', () => {
    const { monitor, clock, changes } = make();
    joins(monitor, clock, 5);
    clock.t += 14 * MIN;
    assert.equal(monitor.isActive(), true);
    clock.t += 2 * MIN;
    assert.equal(monitor.isActive(), false);
    assert.deepEqual(changes, ['on:auto', 'off:auto']);
});

test('manual mode stays on until disabled and survives a restart', () => {
    const { monitor, clock, getSaved } = make();
    monitor.enable('staff-1');
    clock.t += 24 * 60 * MIN;
    assert.equal(monitor.isActive(), true);
    const restarted = new RaidMonitor({ windowMs: 60 * SEC, joinCount: 5, calmMs: 15 * MIN, now: () => clock.t, load: getSaved });
    assert.equal(restarted.isActive(), true);
    restarted.disable('staff-1');
    assert.equal(restarted.isActive(), false);
});
