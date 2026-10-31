import type { Client, Guild, GuildMember, Role } from 'discord.js';
import type { RoleResult } from './service.mts';

export interface RoleIds {
    guildId: string;
    verifiedRoleId: string | undefined;
    unverifiedRoleId: string | undefined;
}

/** Checks up front that the bot can hand out this role and explains why not (missing permission / hierarchy). */
export function roleProblem(guild: Guild | undefined, role: Role | undefined, label: string): string | null {
    if (!role) return `the ${label} role was not found in the server`;
    const me = guild?.members.me;
    if (!me) return 'the bot is not a member of the server';
    if (!me.permissions.has('ManageRoles')) return 'the bot lacks the "Manage Roles" permission';
    if (role.managed) return `the ${label} role belongs to an integration`;
    if (role.position >= me.roles.highest.position) {
        return `the bot's top role is at or below the ${label} role (role hierarchy)`;
    }
    return null;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Discord adapter: the service (service.mts) only sees Discord through this interface, so tests can fake it.
 * Roles are added/removed one by one; overwriting the whole role list could wipe a role someone else just granted.
 */
export function createDiscordPorts(client: Client, ids: RoleIds) {
    const guild = () => client.guilds.cache.get(ids.guildId);

    async function fetchMember(discordId: string): Promise<GuildMember | null> {
        const g = guild();
        if (!g) return null;
        return g.members.fetch(discordId).catch(() => null);
    }

    const problemWith = (role: Role | undefined, label: string) => roleProblem(guild(), role, label);

    /** Grants the verified role and removes the unverified role. */
    async function grant(discordId: string, reason: string): Promise<RoleResult> {
        const g = guild();
        if (!g) return { ok: false, error: 'server not found' };
        if (!ids.verifiedRoleId) return { ok: false, error: 'the verified role is not configured' };
        const member = await fetchMember(discordId);
        if (!member) return { ok: false, error: 'the member is not in the server' };

        const problem = problemWith(g.roles.cache.get(ids.verifiedRoleId), 'verified');
        if (problem) return { ok: false, error: problem };

        try {
            if (!member.roles.cache.has(ids.verifiedRoleId)) await member.roles.add(ids.verifiedRoleId, reason);
            // Failing to remove the unverified role is not critical (the role was granted), but it is logged.
            if (ids.unverifiedRoleId && member.roles.cache.has(ids.unverifiedRoleId)) {
                await member.roles.remove(ids.unverifiedRoleId, reason).catch((error: unknown) => {
                    console.error('Could not remove the unverified role:', message(error));
                });
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, error: message(error) };
        }
    }

    async function revoke(discordId: string, reason: string): Promise<RoleResult> {
        const member = await fetchMember(discordId);
        if (!member) return { ok: false, error: 'the member is not in the server' };
        try {
            if (ids.verifiedRoleId && member.roles.cache.has(ids.verifiedRoleId)) {
                await member.roles.remove(ids.verifiedRoleId, reason);
            }
            if (ids.unverifiedRoleId && !member.roles.cache.has(ids.unverifiedRoleId)) {
                await member.roles.add(ids.unverifiedRoleId, reason);
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, error: message(error) };
        }
    }

    async function isMember(discordId: string): Promise<boolean> {
        return (await fetchMember(discordId)) !== null;
    }

    return { roles: { grant, revoke }, isMember };
}
