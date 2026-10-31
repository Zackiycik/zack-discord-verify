import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as store from '../verification/store.mts';
import { DEFAULT_SERVICE_CONFIG, createVerificationService } from '../verification/service.mts';
import type { ServicePorts, SubmitInput } from '../verification/service.mts';

// Tests run on an in-memory database (under node --test, db.mts automatically uses ':memory:').
const NOW = Date.UTC(2026, 5, 1);
const HOSTNAME = 'site.test';
const oldId = (n: number) => String(100000000000000000n + BigInt(n)); // a ~2015 snowflake: an old account

// The database is shared between tests: each test uses its own IP range.
let setups = 0;

function setup() {
    const defaultIp = `198.51.100.${++setups}`;
    let raid = false;
    const granted: string[] = [];
    const notices: string[] = [];
    let currentCdata = '';

    const fetchImpl = (async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes('turnstile')) {
            return Response.json({ success: true, hostname: HOSTNAME, action: 'verify', cdata: currentCdata });
        }
        const ip = decodeURIComponent(new URL(href).pathname.split('/').pop() ?? '');
        return Response.json({ status: 'ok', [ip]: { proxy: 'no', type: 'residential', risk: 0, isocode: 'TR', timezone: 'Europe/Istanbul' } });
    }) as typeof fetch;

    const ports: ServicePorts = {
        now: () => NOW,
        fetchImpl,
        isMember: async () => true,
        roles: {
            grant: async (id) => (granted.push(id), { ok: true }),
            revoke: async () => ({ ok: true }),
        },
        notifier: {
            attemptRecorded: (a) => void notices.push(`recorded:${a.decision}`),
            reviewRequested: (a) => void notices.push(`review:${a.decision}`),
        },
        isRaid: () => raid,
    };
    const service = createVerificationService(
        {
            pepper: 'p'.repeat(32), deviceSecret: 'd'.repeat(32), turnstileSecret: 's', ipFailMode: 'review',
            minAccountAgeDays: 7, reviewThreshold: 40, blockThreshold: 80, retryPerHour: 3, retryPerDay: 6,
            turnstileHostnames: [HOSTNAME], ...DEFAULT_SERVICE_CONFIG,
        },
        ports,
    );

    async function run(userId: number, opts: { ip?: string; deviceToken?: string | null; fingerprint?: string } = {}) {
        const user = { id: oldId(userId), username: `u${userId}`, avatar: 'a', globalName: 'g', publicFlags: 0, bot: false, system: false };
        const ip = opts.ip ?? defaultIp;
        const net = { ip, ipCountry: 'TR', ipTimezone: 'Europe/Istanbul' };
        const created = await service.createSession(user, net);
        if (created.status !== 'ok') return { created } as const;
        const view = service.viewSession(created.sessionToken);
        assert.ok(view.ok);
        currentCdata = view.cdata;
        // behave like a user who stayed on the page long enough and interacted
        (ports as { now: () => number }).now = () => NOW + 10_000;
        const submitted = await service.submit({
            sessionToken: created.sessionToken, turnstileToken: 'tok', deviceToken: opts.deviceToken ?? null,
            fingerprint: opts.fingerprint ?? `fp-${userId}`, clientTz: 'Europe/Istanbul', clientLangs: ['tr-TR'],
            interactions: { pointer: 5, touch: 0, key: 2, focus: 1 },
            headless: { webdriver: false, headlessUa: false, chromeObjectMissing: false, zeroOuterSize: false, pluginsEmpty: false, swiftShader: false, languagesEmpty: false },
            ...net,
        } satisfies SubmitInput);
        (ports as { now: () => number }).now = () => NOW;
        return { created, submitted } as const;
    }
    return { service, run, granted, notices, setRaid: (v: boolean) => (raid = v), defaultIp };
}

const decisionOf = (r: Awaited<ReturnType<ReturnType<typeof setup>['run']>>) =>
    r.submitted?.status === 'done' ? r.submitted.decision : r.submitted?.status ?? r.created.status;

test('a clean user is approved right after submitting, gets the role and the result is "verified"', async () => {
    const t = setup();
    const r = await t.run(1);
    assert.equal(decisionOf(r), 'approved');
    assert.ok(r.submitted?.status === 'done');
    assert.deepEqual(t.service.getResult(r.submitted.resultToken), { status: 'verified' });
    assert.deepEqual(t.granted, [oldId(1)]);
    assert.ok(t.notices.includes('recorded:approved'));
});

test('a second account with the same device token is blocked', async () => {
    const t = setup();
    const first = await t.run(2);
    assert.ok(first.submitted?.status === 'done');
    const second = await t.run(3, { deviceToken: first.submitted.deviceToken, fingerprint: 'other' });
    assert.equal(decisionOf(second), 'blocked');
    assert.ok(second.submitted?.status === 'done');
    assert.deepEqual(t.service.getResult(second.submitted.resultToken), { status: 'blocked' });
});

test('an alt from a different browser on the same IP goes to manual review and gets no role', async () => {
    const t = setup();
    await t.run(4);
    const second = await t.run(5, { fingerprint: 'other-browser' });
    assert.equal(decisionOf(second), 'manual_review');
    assert.deepEqual(t.granted, [oldId(4)]);
    assert.ok(t.notices.includes('review:manual_review'));
});

test('rotating addresses inside an IPv6 /64 does not break the IP link', async () => {
    const t = setup();
    await t.run(6, { ip: '2a02:4780:12:34::1' });
    const second = await t.run(7, { ip: '2a02:4780:12:34:abcd:ef01:2345:6789', fingerprint: 'x' });
    assert.notEqual(decisionOf(second), 'approved');
});

test('a rejected person is blocked on retry and can try again after a reset', async () => {
    const t = setup();
    await t.run(8);
    const b = await t.run(9, { fingerprint: 'alt' });
    assert.equal(decisionOf(b), 'manual_review');
    const attempt = store.recentAttempts(oldId(9), 1)[0];
    assert.ok(attempt);
    assert.deepEqual(t.service.rejectAttempt(attempt.id, 'staff', 'test'), { status: 'rejected' });

    assert.equal(decisionOf(await t.run(9, { fingerprint: 'alt' })), 'blocked');

    await t.service.resetUser(oldId(9), 'staff', 'test', false);
    assert.equal(store.hasActiveRejection(oldId(9)), false);
});

test('in raid mode even a clean member goes to review and gets the role once staff approve', async () => {
    const t = setup();
    t.setRaid(true);
    const r = await t.run(10);
    assert.equal(decisionOf(r), 'manual_review');
    assert.equal(t.granted.length, 0);
    const attempt = store.recentAttempts(oldId(10), 1)[0];
    assert.ok(attempt && r.submitted?.status === 'done');
    const approved = await t.service.approveAttempt(attempt.id, 'staff', 'test');
    assert.equal(approved.status, 'approved');
    assert.deepEqual(t.granted, [oldId(10)]);
    assert.deepEqual(t.service.getResult(r.submitted.resultToken), { status: 'verified' });
});

test('manual verification records the device, closes the pending review and the result becomes "verified"', async () => {
    const t = setup();
    t.setRaid(true);
    const r = await t.run(12);
    assert.ok(r.submitted?.status === 'done');
    t.setRaid(false);
    await t.service.forceVerify(oldId(12), 'staff', 'test');
    const attempt = store.recentAttempts(oldId(12), 1)[0];
    assert.equal(attempt?.review_outcome, 'approved');
    assert.equal(store.countDeviceOthers('fp', attempt?.fingerprint_hash ?? '', oldId(99)), 1);
    assert.deepEqual(t.service.getResult(r.submitted.resultToken), { status: 'verified' });
    // A new account from the same IP now counts as a "shared IP".
    assert.equal(decisionOf(await t.run(13, { fingerprint: 'other' })), 'manual_review');
});

test('sessions that are never submitted do not use up attempts', async () => {
    const t = setup();
    const user = { id: oldId(14), username: 'u', avatar: 'a', globalName: 'g', publicFlags: 0, bot: false, system: false };
    const net = { ip: '203.0.113.200', ipCountry: 'TR', ipTimezone: null };
    for (let i = 0; i < 6; i++) assert.equal((await t.service.createSession(user, net)).status, 'ok');
});

test('pre-opened sessions cannot be stockpiled to exceed the retry limit', async () => {
    const t = setup();
    const user = { id: oldId(15), username: 'u', avatar: 'a', globalName: 'g', publicFlags: 0, bot: false, system: false };
    const net = { ip: '203.0.113.201', ipCountry: 'TR', ipTimezone: null };
    const first = await t.service.createSession(user, net);
    const second = await t.service.createSession(user, net);
    assert.ok(first.status === 'ok' && second.status === 'ok');
    // Opening a new session invalidates the old one: only one session can be submitted at a time.
    assert.deepEqual(t.service.viewSession(first.sessionToken), { ok: false });
    assert.equal(t.service.viewSession(second.sessionToken).ok, true);
});

test('an already verified person gets the role back without any checks', async () => {
    const t = setup();
    await t.run(16);
    const again = await t.run(16);
    assert.deepEqual(again.created, { status: 'already_verified', rolesOk: true });
});
