import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide } from '../verification/engine.mts';
import { block, review, score } from '../verification/types.mts';
import { deviceSignals } from '../verification/checks/device.mts';
import { turnstileSignals } from '../verification/checks/turnstile.mts';

const opts = { reviewThreshold: 40, blockThreshold: 80 };

test('no signals means approved', () => assert.equal(decide([], opts).decision, 'approved'));
test('BLOCK overrides everything', () => assert.equal(decide([block('X')], opts).decision, 'blocked'));
test('REVIEW sends to manual review', () => assert.equal(decide([review('X')], opts).decision, 'manual_review'));
test('score thresholds', () => {
    assert.equal(decide([score('A', 40)], opts).decision, 'manual_review');
    assert.equal(decide([score('A', 80)], opts).decision, 'blocked');
});
test('in raid mode even a clean member goes to manual review', () => {
    const verdict = decide([], { ...opts, raidMode: true });
    assert.equal(verdict.decision, 'manual_review');
    assert.ok(verdict.reasons.includes('RAID_MODE'));
});
test('another verified account on the same IP requires manual review', () => {
    const signals = deviceSignals({ tokenValid: true, tokenOthers: 0, fingerprintOthers: 0, ipRecentOthers: 1 });
    assert.equal(decide(signals, opts).decision, 'manual_review');
});

test('Turnstile test keys: matching is skipped but a failed captcha is still blocked', () => {
    const exp = { action: 'verify', cdata: 'session', hostnames: ['site.test'], testKeys: true };
    assert.deepEqual(turnstileSignals({ success: true, errorCodes: [], hostname: 'example.com' }, exp), []);
    assert.equal(turnstileSignals({ success: false, errorCodes: ['invalid-input-response'] }, exp)[0]?.kind, 'BLOCK');
    assert.equal(turnstileSignals({ success: true, errorCodes: [], hostname: 'example.com' }, { ...exp, testKeys: false })[0]?.code, 'TURNSTILE_MISMATCH');
});
