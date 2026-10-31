import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
// Bot side (the other half of the contract)
import { NonceStore, signRequest as botSign, verifyRequest as botVerify } from '../../bot/api/auth.mts';
import { botCall, botHealthy } from '../src/lib/botClient';
import { authorizeUrl, exchangeCode, fetchUser, revokeToken } from '../src/lib/discord';
import { signRequest as siteSign } from '../src/lib/hmac';
import { dict, pick, text } from '../src/lib/copy';
import { clientNetwork } from '../src/lib/net';
import { isSameOrigin } from '../src/lib/origin';
import { createState, verifyState } from '../src/lib/state';

const SECRET = 'k'.repeat(40);

beforeEach(() => {
    Object.assign(process.env, {
        APP_URL: 'https://verify.example.com/',
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'csecret',
        DISCORD_GUILD_ID: '123',
        BOT_API_URL: 'https://bot.example.com/',
        API_SECRET: SECRET,
        SESSION_SECRET: 's'.repeat(40),
    });
    delete process.env['E2E_MOCK_DISCORD'];
    delete process.env['DISCORD_API_BASE'];
});

describe('site ↔ bot signature contract', () => {
    it('site and bot produce exactly the same signature for the same input', () => {
        for (let i = 0; i < 50; i++) {
            const parts = {
                ts: String(1_800_000_000_000 + i),
                nonce: randomBytes(12).toString('base64url'),
                method: i % 2 ? 'POST' : 'post',
                path: `/v1/${randomBytes(4).toString('hex')}/x`,
                body: JSON.stringify({ i, unicode: 'çğıöşü', emoji: '😀', nested: { a: [1, 2, 3] } }),
            };
            expect(siteSign(SECRET, parts)).toBe(botSign(SECRET, parts));
        }
    });

    it('a real request from the site passes the verifier of the bot', async () => {
        let seen: { headers: Record<string, string>; body: string; url: string } | null = null;
        const fetchImpl = (async (url: string, init: RequestInit) => {
            seen = { headers: init.headers as Record<string, string>, body: String(init.body), url };
            return new Response(JSON.stringify({ ok: true, data: { hello: 'world' } }), { status: 200 });
        }) as unknown as typeof fetch;

        const result = await botCall<{ hello: string }>('/v1/session/view', { sessionToken: 'x'.repeat(30) }, fetchImpl);
        expect(result).toEqual({ ok: true, data: { hello: 'world' } });
        expect(seen!.url).toBe('https://bot.example.com/v1/session/view');

        const verdict = botVerify(seen!.headers, 'POST', '/v1/session/view', seen!.body, { secret: SECRET, now: Date.now(), nonces: new NonceStore() });
        expect(verdict).toEqual({ ok: true });
        // The bot rejects it if the body changes
        const tampered = botVerify(seen!.headers, 'POST', '/v1/session/view', seen!.body + ' ', { secret: SECRET, now: Date.now(), nonces: new NonceStore() });
        expect(tampered).toEqual({ ok: false, reason: 'signature' });
    });

    it('every request uses a new nonce', async () => {
        const nonces: string[] = [];
        const fetchImpl = (async (_u: string, init: RequestInit) => {
            nonces.push((init.headers as Record<string, string>)['x-nonce']!);
            return new Response(JSON.stringify({ ok: true, data: {} }));
        }) as unknown as typeof fetch;
        await botCall('/v1/x', {}, fetchImpl);
        await botCall('/v1/x', {}, fetchImpl);
        expect(new Set(nonces).size).toBe(2);
        expect(nonces[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    });
});

describe('botClient error handling', () => {
    const respond = (status: number, json: unknown) => (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch;

    it('does not throw when the bot is down, returns unreachable', async () => {
        const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
        expect(await botCall('/v1/x', {}, down)).toEqual({ ok: false, status: 503, error: 'unreachable' });
        expect(await botHealthy(down)).toBe(false);
    });

    it('passes on error codes and the retry delay', async () => {
        expect(await botCall('/v1/x', {}, respond(401, { ok: false, error: 'unauthorized' }))).toEqual({ ok: false, status: 401, error: 'unauthorized' });
        expect(await botCall('/v1/x', {}, respond(429, { ok: false, error: 'rate_limited', retryAfterSec: 42 }))).toEqual({ ok: false, status: 429, error: 'rate_limited', retryAfterSec: 42 });
        expect(await botCall('/v1/x', {}, respond(500, 'html error page'))).toMatchObject({ ok: false, status: 500, error: 'internal' });
        expect(await botCall('/v1/x', {}, (async () => new Response('garbled', { status: 200 })) as unknown as typeof fetch)).toMatchObject({ ok: false });
    });

    it('health check', async () => {
        expect(await botHealthy(respond(200, { ok: true }))).toBe(true);
        expect(await botHealthy(respond(503, { ok: false }))).toBe(false);
    });

    it('no request is sent if API_SECRET is too short', async () => {
        process.env['API_SECRET'] = 'short';
        await expect(botCall('/v1/x', {}, respond(200, {}))).rejects.toThrow(/at least 32/);
    });
});

describe('OAuth state', () => {
    const secret = 's'.repeat(40);

    it('a correct pair is accepted and every state is different', () => {
        const a = createState(secret);
        expect(verifyState(secret, a.cookieValue, a.state)).toBe(true);
        expect(createState(secret).state).not.toBe(a.state);
    });

    it('forged, missing or differently-signed values are rejected', () => {
        const a = createState(secret);
        const b = createState(secret);
        expect(verifyState(secret, a.cookieValue, b.state)).toBe(false);
        expect(verifyState(secret, b.cookieValue, a.state)).toBe(false);
        expect(verifyState(secret, undefined, a.state)).toBe(false);
        expect(verifyState(secret, a.cookieValue, null)).toBe(false);
        expect(verifyState(secret, `${a.state}.forgedsignature`, a.state)).toBe(false);
        expect(verifyState(secret, a.state, a.state)).toBe(false);
        expect(verifyState(secret, '', '')).toBe(false);
        expect(verifyState('z'.repeat(40), a.cookieValue, a.state)).toBe(false);
    });
});

describe('network info (Vercel headers)', () => {
    const h = (o: Record<string, string>) => new Headers(o);

    it('x-real-ip wins, otherwise the first x-forwarded-for value', () => {
        expect(clientNetwork(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' })).ip).toBe('1.2.3.4');
        expect(clientNetwork(h({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' })).ip).toBe('5.6.7.8');
        expect(clientNetwork(h({ 'x-real-ip': '2001:db8::1' })).ip).toBe('2001:db8::1');
    });

    it('safe default for an invalid or missing IP', () => {
        expect(clientNetwork(h({})).ip).toBe('127.0.0.1');
        expect(clientNetwork(h({ 'x-real-ip': 'not-an-ip' })).ip).toBe('127.0.0.1');
        expect(clientNetwork(h({ 'x-forwarded-for': '<script>' })).ip).toBe('127.0.0.1');
    });

    it('country and timezone', () => {
        expect(clientNetwork(h({ 'x-vercel-ip-country': 'tr', 'x-vercel-ip-timezone': 'Europe%2FIstanbul' }))).toMatchObject({ ipCountry: 'TR', ipTimezone: 'Europe/Istanbul' });
        expect(clientNetwork(h({ 'x-vercel-ip-country': 'TURKEY' })).ipCountry).toBeNull();
        expect(clientNetwork(h({ 'x-vercel-ip-timezone': '%E0%A4%A' })).ipTimezone).toBeNull();
        expect(clientNetwork(h({ 'x-vercel-ip-timezone': 'x'.repeat(200) })).ipTimezone).toHaveLength(64);
    });
});

describe('origin check (CSRF)', () => {
    const req = (origin?: string) => new Request('https://verify.example.com/api/x', { method: 'POST', headers: origin ? { origin } : {} });
    it('only our own site is accepted', () => {
        expect(isSameOrigin(req('https://verify.example.com'))).toBe(true);
        expect(isSameOrigin(req('https://evil.example'))).toBe(false);
        expect(isSameOrigin(req('https://verify.example.com.evil.example'))).toBe(false);
        expect(isSameOrigin(req('http://verify.example.com'))).toBe(false);
        expect(isSameOrigin(req())).toBe(false);
        expect(isSameOrigin(req('null'))).toBe(false);
    });
});

describe('copy', () => {
    it('all texts exist and are not empty', () => {
        for (const key of Object.keys(dict) as (keyof typeof dict)[]) {
            expect(dict[key].trim().length, key).toBeGreaterThan(2);
        }
    });

    it('variable substitution and pick', () => {
        expect(text('challengeHello', { name: 'Ali' })).toBe('Hello, Ali');
        expect(text('r_rate_body', { minutes: 7 })).toContain('7 minutes');
        expect(pick(['verify', 'checking'])).toEqual({ verify: 'Verify', checking: 'Checking…' });
        // HTML/script stays text (React escapes it); only the template runs here
        expect(text('challengeHello', { name: '<b>x</b>' })).toBe('Hello, <b>x</b>');
    });
});

describe('Discord OAuth client', () => {
    it('only the identify scope and the right redirect are requested', () => {
        const url = new URL(authorizeUrl('abc'));
        expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
        expect(url.searchParams.get('scope')).toBe('identify');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('state')).toBe('abc');
        expect(url.searchParams.get('client_id')).toBe('cid');
        expect(url.searchParams.get('redirect_uri')).toBe('https://verify.example.com/api/auth/discord/callback');
        expect(url.searchParams.get('client_secret')).toBeNull();
    });

    it('test server addresses are only used when explicitly allowed', () => {
        process.env['DISCORD_AUTHORIZE_URL'] = 'http://evil.example/authorize';
        expect(new URL(authorizeUrl('s')).hostname).toBe('discord.com');
        process.env['E2E_MOCK_DISCORD'] = '1';
        expect(new URL(authorizeUrl('s')).hostname).toBe('evil.example');
        delete process.env['DISCORD_AUTHORIZE_URL'];
    });

    it('only whitelisted fields are taken from the user response', async () => {
        const fetchImpl = (async () =>
            new Response(JSON.stringify({
                id: '1', username: 'ali', global_name: null, avatar: 'abc', public_flags: 64, bot: false,
                email: 'secret@example.com', locale: 'tr', mfa_enabled: true, banner: null, accent_color: 1,
            }))) as unknown as typeof fetch;
        const user = await fetchUser('tok', fetchImpl);
        expect(user).toEqual({ id: '1', username: 'ali', global_name: null, avatar: 'abc', public_flags: 64, bot: false, system: false });
        expect(JSON.stringify(user)).not.toContain('secret@');
    });

    it('garbled or failed responses return null and do not throw', async () => {
        const bad = (r: () => Response | Promise<Response>) => (async () => r()) as unknown as typeof fetch;
        expect(await fetchUser('t', bad(() => new Response('{}', { status: 401 })))).toBeNull();
        expect(await fetchUser('t', bad(() => new Response(JSON.stringify({ id: 5 }))))).toBeNull();
        expect(await fetchUser('t', bad(() => { throw new Error('network'); }))).toBeNull();
        expect(await exchangeCode('c', bad(() => new Response('{}', { status: 400 })))).toBeNull();
        expect(await exchangeCode('c', bad(() => new Response(JSON.stringify({ access_token: 5 }))))).toBeNull();
        expect(await exchangeCode('c', bad(() => new Response(JSON.stringify({ access_token: 'abc' }))))).toBe('abc');
        await expect(revokeToken('t', bad(() => { throw new Error('network'); }))).resolves.toBeUndefined();
    });

    it('on token exchange the client secret goes in the body, not the URL', async () => {
        let call: { url: string; body: string } | null = null;
        const fetchImpl = (async (url: string, init: RequestInit) => {
            call = { url, body: String(init.body) };
            return new Response(JSON.stringify({ access_token: 'tok' }));
        }) as unknown as typeof fetch;
        await exchangeCode('code123', fetchImpl);
        expect(call!.url).not.toContain('csecret');
        const form = new URLSearchParams(call!.body);
        expect(form.get('client_secret')).toBe('csecret');
        expect(form.get('code')).toBe('code123');
        expect(form.get('grant_type')).toBe('authorization_code');
    });
});


describe('production guards', () => {
    const set = (env: string) => ((process.env as Record<string, string>)['NODE_ENV'] = env);
    const original = process.env['NODE_ENV'];
    afterEach(() => set(original ?? 'test'));

    it('the bot URL must be https in production (loopback excepted)', async () => {
        const { env } = await import('../src/lib/env');
        set('production');
        process.env['BOT_API_URL'] = 'http://bot.example.com';
        expect(() => env.botApiUrl).toThrow(/https/);
        process.env['BOT_API_URL'] = 'http://127.0.0.1:8787';
        expect(env.botApiUrl).toBe('http://127.0.0.1:8787');
        process.env['BOT_API_URL'] = 'https://bot.example.com/';
        expect(env.botApiUrl).toBe('https://bot.example.com');
    });

    it('the mock Discord switch is refused in production', async () => {
        set('production');
        process.env['E2E_MOCK_DISCORD'] = '1';
        expect(() => authorizeUrl('s')).toThrow(/production/);
    });
});
