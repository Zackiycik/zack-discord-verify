import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'discord.js';
import { createDiscordPorts, roleProblem } from '../verification/roles.mts';

const VERIFIED = '200000000000000001';
const UNVERIFIED = '200000000000000002';
const USER = '300000000000000001';

interface FakeOptions { hierarchyOk?: boolean; manageRoles?: boolean; inGuild?: boolean; held?: string[] }

function fakeClient(opts: FakeOptions = {}) {
    const { hierarchyOk = true, manageRoles = true, inGuild = true, held = [UNVERIFIED] } = opts;
    const calls: string[] = [];
    const owned = new Set(held);
    const member = {
        roles: {
            cache: { has: (id: string) => owned.has(id) },
            add: async (id: string) => void (owned.add(id), calls.push(`add:${id}`)),
            remove: async (id: string) => void (owned.delete(id), calls.push(`remove:${id}`)),
        },
    };
    const role = (id: string) => ({ id, managed: false, position: hierarchyOk ? 1 : 10 });
    const guild = {
        members: { me: { permissions: { has: () => manageRoles }, roles: { highest: { position: 5 } } }, fetch: async () => (inGuild ? member : Promise.reject(new Error('unknown member'))) },
        roles: { cache: new Map([[VERIFIED, role(VERIFIED)], [UNVERIFIED, role(UNVERIFIED)]]) },
    };
    const client = { guilds: { cache: new Map([['1', guild]]) } } as unknown as Client;
    return { client, calls, owned };
}

const ids = { guildId: '1', verifiedRoleId: VERIFIED, unverifiedRoleId: UNVERIFIED };

test('grant gives the verified role and removes the unverified one', async () => {
    const f = fakeClient();
    const result = await createDiscordPorts(f.client, ids).roles.grant(USER, 'test');
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(f.calls, [`add:${VERIFIED}`, `remove:${UNVERIFIED}`]);
});

test('grant explains why it cannot work (hierarchy, permission, member missing)', async () => {
    const hierarchy = await createDiscordPorts(fakeClient({ hierarchyOk: false }).client, ids).roles.grant(USER, 'test');
    assert.match(hierarchy.error ?? '', /role hierarchy/);
    const permission = await createDiscordPorts(fakeClient({ manageRoles: false }).client, ids).roles.grant(USER, 'test');
    assert.match(permission.error ?? '', /Manage Roles/);
    const gone = await createDiscordPorts(fakeClient({ inGuild: false }).client, ids).roles.grant(USER, 'test');
    assert.match(gone.error ?? '', /not in the server/);
});

test('revoke removes the verified role and restores the unverified one', async () => {
    const f = fakeClient({ held: [VERIFIED] });
    assert.deepEqual(await createDiscordPorts(f.client, ids).roles.revoke(USER, 'test'), { ok: true });
    assert.deepEqual(f.calls, [`remove:${VERIFIED}`, `add:${UNVERIFIED}`]);
});

test('roleProblem handles a missing role', () => {
    assert.match(roleProblem(undefined, undefined, 'verified') ?? '', /not found/);
});
