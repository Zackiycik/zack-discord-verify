import { PermissionFlagsBits } from 'discord.js';
import type { Client } from 'discord.js';
import { config } from '../config.mts';
import type { BotClient } from '../types.mts';
import { getNotifier, markStartupSettled } from '../verification/runtime.mts';
import { startVerification } from '../verification/boot.mts';

export const name = 'clientReady';
export const once = true;

const REQUIRED_ROLES = [
    ['verifiedRoleId', 'VERIFIED_ROLE_ID'],
    ['unverifiedRoleId', 'UNVERIFIED_ROLE_ID'],
] as const;

function auditConfig(client: Client): void {
    const problems: string[] = [];

    if (config.staffRoleIds.length === 0) {
        problems.push('STAFF_ROLE_IDS is empty: staff checks fall back to the "Manage Server" permission only.');
    }

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) {
        problems.push(`No server matches GUILD_ID (${config.guildId}).`);
        return report(problems);
    }

    for (const roleId of config.staffRoleIds) {
        if (!guild.roles.cache.has(roleId)) problems.push(`STAFF_ROLE_IDS: role ${roleId} does not exist in the server.`);
    }

    const me = guild.members.me;
    if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        problems.push('The bot lacks the "Manage Roles" permission: verification will not work.');
    }

    for (const [key, label] of REQUIRED_ROLES) {
        const roleId = config[key];
        if (!roleId) continue;
        const role = guild.roles.cache.get(roleId);
        if (!role) {
            problems.push(`${label}: role ${roleId} does not exist in the server.`);
        } else if (me && role.position >= me.roles.highest.position) {
            // If the bot's role is below this role it cannot hand it out; if UNVERIFIED cannot be granted, new members see everything.
            problems.push(`${label}: the bot's top role is at or below this role, so it cannot be granted.`);
        }
    }

    report(problems);
}

function report(problems: string[]): void {
    if (problems.length === 0) return console.log('🔒 Configuration audit clean.');
    console.warn(`⚠️  Configuration audit found ${problems.length} warning(s):`);
    for (const problem of problems) console.warn(`   • ${problem}`);
}

export function execute(client: Client): void {
    console.log(`✅ Logged in as ${client.user?.tag}.`);

    try {
        auditConfig(client);
    } catch (error) {
        console.error('Configuration audit failed:', error);
    }

    startVerification(client, config)
        .then((running) => {
            (client as BotClient & { verification?: unknown }).verification = running;
            console.log(`🌐 Verification API listening on ${config.apiHost}:${config.apiPort}`);
        })
        .catch((error: unknown) => {
            // The bot stays up; only web verification is down. State the reason and tell staff.
            console.error('❌ Could not start the verification API (is the port in use?):', error);
            const reason = (error as { code?: string; message?: string })?.code ?? (error as Error)?.message ?? String(error);
            getNotifier()
                ?.staffAction(`**The verification API could not be started**, the site cannot verify anyone: ${reason}`)
                .catch(() => {});
        })
        .finally(() => markStartupSettled());
}
