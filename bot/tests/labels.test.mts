import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signalLabel, signalLine } from '../verification/labels.mts';
import { block, review, score } from '../verification/types.mts';

test('staff-facing signal labels', () => {
    assert.equal(signalLabel('IP_SHARED'), 'Another account was verified from the same IP recently');
    assert.equal(signalLabel('UNKNOWN_CODE'), 'UNKNOWN_CODE', 'unknown codes are shown as they are');
    assert.equal(signalLine(score('LANG_MISMATCH', 5, 'en-US')), '`+5`  Browser language does not match the expected language - *en-US*');
    assert.match(signalLine(review('IP_SHARED', '1 account(s)')), /^`REVIEW`  /);
    assert.match(signalLine(block('DEVICE_TOKEN_REUSED')), /^`BLOCK`  /);
});

test('every signal code has a label', () => {
    const codes = ['DEVICE_TOKEN_REUSED', 'IP_CHECK_FAILED', 'PREVIOUSLY_REJECTED', 'TURNSTILE_FAILED', 'TURNSTILE_MISMATCH',
        'ACCOUNT_SPAMMER_FLAG', 'ACCOUNT_TOO_NEW', 'DEVICE_FP_MATCH', 'IP_PROXY', 'IP_SHARED', 'TURNSTILE_UNAVAILABLE',
        'ACCOUNT_YOUNG', 'FAST_SUBMIT', 'HEADLESS', 'IP_HIGH_RISK', 'LANG_MISMATCH', 'NO_AVATAR', 'NO_GLOBAL_NAME',
        'NO_INTERACTION', 'STORAGE_CLEARED', 'TZ_MISMATCH', 'TZ_MISSING', 'RAID_MODE'];
    for (const code of codes) assert.notEqual(signalLabel(code), code, code);
});
