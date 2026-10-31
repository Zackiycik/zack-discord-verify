import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeIp } from '../verification/hash.mts';

test('IPv4 stays as is', () => {
    assert.equal(normalizeIp('203.0.113.7'), '203.0.113.7');
});

test('IPv4-mapped IPv6 counts as IPv4', () => {
    assert.equal(normalizeIp('::ffff:203.0.113.7'), '203.0.113.7');
});

test('IPv6 addresses in the same /64 collapse to one value', () => {
    const a = normalizeIp('2a02:4780:12:34:aaaa:bbbb:cccc:dddd');
    const b = normalizeIp('2a02:4780:12:34:1:2:3:4');
    assert.equal(a, b);
    assert.notEqual(a, normalizeIp('2a02:4780:12:35::1'));
});

test('compressed IPv6 is expanded correctly', () => {
    assert.equal(normalizeIp('2001:db8::1'), normalizeIp('2001:0db8:0:0:0:0:0:1'));
});

test('special ::/64 forms do not fall into one bucket', () => {
    assert.notEqual(normalizeIp('::1'), normalizeIp('::2'));
    assert.equal(normalizeIp('::ffff:cb00:7107'), '203.0.113.7');
});
