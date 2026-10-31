import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountSignals } from '../verification/checks/account.mts';
import { behaviorSignals } from '../verification/checks/behavior.mts';
import { deviceSignals } from '../verification/checks/device.mts';
import { ipSignals, isPrivateIp, lookupProxycheck } from '../verification/checks/ipReputation.mts';
import { localeSignals, utcOffsetMinutes } from '../verification/checks/locale.mts';
import { snowflakeToMs } from '../verification/snowflake.mts';

const NOW = Date.UTC(2026, 5, 1, 12);
const DAY = 24 * 60 * 60 * 1000;
const idAged = (days: number) => String((BigInt(NOW - days * DAY - 1420070400000) << 22n) | 1n);
const codes = (signals: { code: string }[]) => signals.map((s) => s.code).sort();
const calm = { pointer: 3, touch: 0, key: 1, focus: 1 };
const noHeadless = { webdriver: false, headlessUa: false, chromeObjectMissing: false, zeroOuterSize: false, pluginsEmpty: false, swiftShader: false, languagesEmpty: false };

test('snowflake decodes to the account creation time', () => {
    assert.ok(Math.abs(snowflakeToMs(idAged(10)) - (NOW - 10 * DAY)) < 1000);
});

test('account: very new accounts need review, old complete accounts are clean', () => {
    const fresh = accountSignals({ id: idAged(1), avatar: 'a', globalName: 'g', publicFlags: 0 }, { now: NOW, minAgeDays: 7 });
    assert.deepEqual(codes(fresh), ['ACCOUNT_TOO_NEW', 'ACCOUNT_YOUNG']);
    const old = accountSignals({ id: idAged(400), avatar: 'a', globalName: 'g', publicFlags: 0 }, { now: NOW, minAgeDays: 7 });
    assert.deepEqual(old, []);
    const bare = accountSignals({ id: idAged(400), avatar: null, globalName: null, publicFlags: 1 << 20 }, { now: NOW, minAgeDays: 7 });
    assert.deepEqual(codes(bare), ['ACCOUNT_SPAMMER_FLAG', 'NO_AVATAR', 'NO_GLOBAL_NAME']);
});

test('behaviour: fast submit, no interaction and automation hints add score', () => {
    assert.deepEqual(behaviorSignals({ elapsedMs: 10_000, interactions: calm, headless: noHeadless }), []);
    assert.deepEqual(codes(behaviorSignals({ elapsedMs: 500, interactions: calm, headless: noHeadless })), ['FAST_SUBMIT']);
    assert.deepEqual(codes(behaviorSignals({ elapsedMs: null, interactions: { pointer: 0, touch: 0, key: 0, focus: 0 }, headless: { ...noHeadless, webdriver: true } })),
        ['FAST_SUBMIT', 'HEADLESS', 'NO_INTERACTION']);
});

test('device: token reuse blocks, fingerprint and shared IP only ask for review', () => {
    const base = { tokenValid: true, tokenOthers: 0, fingerprintOthers: 0, ipRecentOthers: 0 };
    assert.deepEqual(deviceSignals(base), []);
    assert.equal(deviceSignals({ ...base, tokenOthers: 1 })[0]?.kind, 'BLOCK');
    assert.equal(deviceSignals({ ...base, fingerprintOthers: 1 })[0]?.kind, 'REVIEW');
    assert.deepEqual(codes(deviceSignals({ ...base, tokenValid: false, fingerprintOthers: 1 })), ['DEVICE_FP_MATCH', 'STORAGE_CLEARED']);
    assert.equal(deviceSignals({ ...base, ipRecentOthers: 2 })[0]?.kind, 'REVIEW');
});

test('IP: private addresses are skipped, failure follows the configured mode', () => {
    assert.ok(isPrivateIp('192.168.1.5') && isPrivateIp('127.0.0.1') && isPrivateIp('::1'));
    assert.ok(!isPrivateIp('203.0.113.7'));
    assert.deepEqual(ipSignals({ ok: true, skipped: true }, 'closed'), []);
    assert.equal(ipSignals({ ok: false }, 'closed')[0]?.kind, 'BLOCK');
    assert.equal(ipSignals({ ok: false }, 'review')[0]?.kind, 'REVIEW');
    assert.equal(ipSignals({ ok: false }, 'open')[0]?.kind, 'SCORE');
    const proxy = { ok: true, info: { proxy: true, vpn: false, tor: false, datacenter: false, risk: 90, country: 'DE', timezone: null, type: 'VPN' } };
    assert.deepEqual(codes(ipSignals(proxy, 'review')), ['IP_HIGH_RISK', 'IP_PROXY']);
});

test('proxycheck: an unexpected response is a failed lookup, never "clean"', async () => {
    const bad = (async () => Response.json({ status: 'error' })) as typeof fetch;
    assert.equal((await lookupProxycheck({ ip: '203.0.113.7', fetchImpl: bad })).ok, false);
    const good = (async () => Response.json({ status: 'ok', '203.0.113.7': { proxy: 'no', type: 'Residential', risk: 0, isocode: 'tr', timezone: 'Europe/Istanbul' } })) as typeof fetch;
    const result = await lookupProxycheck({ ip: '203.0.113.7', fetchImpl: good });
    assert.equal(result.ok && result.info?.country, 'TR');
});

test('locale: timezone aliases match, mismatches and the optional language hint add score', () => {
    assert.equal(utcOffsetMinutes('Europe/Istanbul', NOW), utcOffsetMinutes('Asia/Istanbul', NOW));
    assert.ok(Number.isNaN(utcOffsetMinutes('Not/AZone', NOW)));
    const base = { clientTz: 'Europe/Istanbul', ipTz: 'Europe/Istanbul', clientLangs: ['en-US'], ipCountry: 'TR', now: NOW };
    assert.deepEqual(localeSignals(base), []);
    assert.deepEqual(codes(localeSignals({ ...base, ipTz: 'America/New_York' })), ['TZ_MISMATCH']);
    assert.deepEqual(codes(localeSignals({ ...base, clientTz: null })), ['TZ_MISSING']);
    assert.deepEqual(codes(localeSignals({ ...base, hint: { country: 'TR', language: 'tr' } })), ['LANG_MISMATCH']);
    assert.deepEqual(localeSignals({ ...base, clientLangs: ['tr-TR'], hint: { country: 'TR', language: 'tr' } }), []);
});
