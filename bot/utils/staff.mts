import { PermissionFlagsBits } from 'discord.js';
import type { GuildMember } from 'discord.js';
import type { APIInteractionGuildMember } from 'discord.js';
import { config } from '../config.mts';

/**
 * Fails closed: if STAFF_ROLE_IDS is empty or wrong, nobody counts as staff. To avoid locking everyone out,
 * members with the "Manage Server" permission are always staff.
 */
export function isStaff(member: GuildMember | APIInteractionGuildMember | null): boolean {
    if (!member) return false;
    const permissions = member.permissions;
    if (typeof permissions !== 'string' && permissions.has(PermissionFlagsBits.ManageGuild)) return true;
    const roles = member.roles;
    if (!Array.isArray(roles) && 'cache' in roles) return config.staffRoleIds.some((id) => roles.cache.has(id));
    return Array.isArray(roles) && config.staffRoleIds.some((id) => roles.includes(id));
}
