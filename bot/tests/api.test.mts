import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { NonceStore, signRequest, verifyRequest } from '../api/auth.mts';
import { RateLimiter } from '../api/ratelimit.mts';
import { createApiServer } from '../api/server.mts';
import type { VerificationService } from '../verification/service.mts';

const SECRET = 's3cret-'.repeat(8);
const NOW = 1_800_000_000_000;

test('signature: a valid request passes, every kind of tampering is rejected', () => {
    const nonces = new NonceStore();
    const parts = { ts: String(NOW), nonce: 'n'.repeat(20), method: 'POST', path: '/v1/x', body: '{"a":1}' };
    const headers = (over: Record<string, string> = {}) => ({
        'x-ts': parts.ts, 'x-nonce': parts.nonce, 'x-signature': signRequest(SECRET, parts), ...over,
    });
    const check = (h: Record<string, string>, body = parts.body, path = parts.path, at = NOW) =>
        verifyRequest(h, 'POST', path, body, { secret: SECRET, now: at, nonces: new NonceStore() });

    assert.deepEqual(verifyRequest(headers(), 'POST', parts.path, parts.body, { secret: SECRET, now: NOW, nonces }), { ok: true });
    assert.deepEqual(verifyRequest(headers(), 'POST', parts.path, parts.body, { secret: SECRET, now: NOW, nonces }), { ok: false, reason: 'replay' });

    assert.deepEqual(check(headers(), '{"a":2}'), { ok: false, reason: 'signature' }, 'body changed');
    assert.deepEqual(check(headers(), parts.body, '/v1/y'), { ok: false, reason: 'signature' }, 'path changed');
    assert.deepEqual(check(headers(), parts.body, parts.path, NOW + 61_000), { ok: false, reason: 'expired' });
    assert.deepEqual(check(headers(), parts.body, parts.path, NOW - 61_000), { ok: false, reason: 'expired' });
    assert.deepEqual(check(headers({ 'x-signature': 'f'.repeat(64) })), { ok: false, reason: 'signature' });
    assert.deepEqual(check(headers({ 'x-signature': 'short' })), { ok: false, reason: 'signature-format' });
    assert.deepEqual(check(headers({ 'x-nonce': 'a' })), { ok: false, reason: 'nonce' });
    assert.deepEqual(check(headers({ 'x-ts': 'abc' })), { ok: false, reason: 'ts' });
    assert.deepEqual(check({}), { ok: false, reason: 'ts' });
    // the method is signed too
    assert.deepEqual(verifyRequest(headers(), 'GET', parts.path, parts.body, { secret: SECRET, now: NOW, nonces: new NonceStore() }), { ok: false, reason: 'signature' });

    // forged signatures must not burn a legitimate nonce
    const store = new NonceStore();
    verifyRequest(headers({ 'x-signature': 'e'.repeat(64) }), 'POST', parts.path, parts.body, { secret: SECRET, now: NOW, nonces: store });
    assert.deepEqual(verifyRequest(headers(), 'POST', parts.path, parts.body, { secret: SECRET, now: NOW, nonces: store }), { ok: true });
});

test('rate limiter', () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) assert.equal(limiter.hit('a', 3, 1000, 0).allowed, true);
    const blocked = limiter.hit('a', 3, 1000, 100);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSec, 1);
    assert.equal(limiter.hit('a', 3, 1000, 1001).allowed, true, 'a new window starts');
    assert.equal(limiter.hit('b', 3, 1000, 100).allowed, true, 'keys are independent');
});

// A minimal fake service: the API layer only needs these methods.
const calls: string[] = [];
const service = {
    createSession: async () => (calls.push('create'), { status: 'ok', sessionToken: 'x'.repeat(30) }),
    viewSession: () => ({ ok: false }),
    submit: async () => ({ status: 'done', decision: 'blocked', deviceToken: 'dev', resultToken: 'res' }),
    getResult: () => ({ status: 'rejected' }),
} as unknown as VerificationService;

async function start(ready?: () => boolean) {
    const server: Server = createApiServer({
        service, secret: SECRET, now: () => NOW, logger: { error() {}, warn() {} }, ...(ready ? { ready } : {}),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (path: string, payload: unknown, opts: { secret?: string; sendBody?: string } = {}) => {
        const body = JSON.stringify(payload);
        const nonce = crypto.randomBytes(16).toString('hex');
        const signature = signRequest(opts.secret ?? SECRET, { ts: String(NOW), nonce, method: 'POST', path, body });
        const res = await fetch(base + path, {
            method: 'POST', body: opts.sendBody ?? body,
            headers: { 'content-type': 'application/json', 'x-ts': String(NOW), 'x-nonce': nonce, 'x-signature': signature },
        });
        return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    return { call, base, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

const createBody = {
    user: { id: '100000000000000001', username: 'ali', global_name: 'Ali', avatar: 'abc', public_flags: 0 },
    ip: '203.0.113.7', ipCountry: 'TR', ipTimezone: 'Europe/Istanbul',
};

test('API: signed requests work, unsigned or wrongly signed ones get a bare 401', async () => {
    const api = await start();
    try {
        const ok = await api.call('/v1/session/create', createBody);
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.json, { ok: true, data: { status: 'ok', sessionToken: 'x'.repeat(30) } });

        const wrong = await api.call('/v1/session/create', createBody, { secret: 'wrong-'.repeat(8) });
        assert.deepEqual([wrong.status, wrong.json], [401, { ok: false, error: 'unauthorized' }]);

        const tampered = await api.call('/v1/session/create', createBody, { sendBody: JSON.stringify({ ...createBody, ip: '198.51.100.1' }) });
        assert.equal(tampered.status, 401);
    } finally {
        await api.close();
    }
});

test('API: unknown fields and oversized bodies are rejected, a staff rejection looks like a block', async () => {
    const api = await start();
    try {
        const extra = await api.call('/v1/session/create', { ...createBody, admin: true });
        assert.deepEqual([extra.status, extra.json], [400, { ok: false, error: 'bad_request' }]);

        const big = await api.call('/v1/session/create', { ...createBody, pad: 'x'.repeat(20_000) });
        assert.equal(big.status, 413);

        const result = await api.call('/v1/result/get', { resultToken: 'r'.repeat(30), ip: '203.0.113.7' });
        assert.deepEqual(result.json, { ok: true, data: { status: 'blocked' } });

        const missing = await api.call('/v1/nope', {});
        assert.equal(missing.status, 404);
    } finally {
        await api.close();
    }
});

test('API: /health is unsigned and follows readiness', async () => {
    let ready = false;
    const api = await start(() => ready);
    try {
        assert.equal((await fetch(`${api.base}/health`)).status, 503);
        ready = true;
        assert.equal((await fetch(`${api.base}/health`)).status, 200);
    } finally {
        await api.close();
    }
});
