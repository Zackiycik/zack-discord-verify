import type { GuildMember } from 'discord.js';
import { config } from '../config.mts';
import { COLORS, ago, card, date, tag } from '../utils/style.mts';
import { sendJoinLog } from '../utils/serverLog.mts';
import { clip } from '../utils/text.mts';
import * as runtime from '../verification/runtime.mts';

export const name = 'guildMemberAdd';

export async function execute(member: GuildMember): Promise<void> {
    if (config.guildId && member.guild.id !== config.guildId) return;

    // A member who joins while the bot is starting must not be treated as "no service".
    await runtime.waitForStartup();

    // A member who verified on the web before gets their roles back without any checks.
    let restored: string = 'not_verified';
    const service = runtime.getService();
    if (service) restored = await service.restoreMember(member.id).catch(() => 'failed');

    // Many joins in a short time switch raid mode on (verifications go to manual review).
    // Bots and returning verified members do not inflate the raid counter.
    if (!member.user.bot && restored !== 'restored') {
        try {
            runtime.getRaid()?.recordJoin();
        } catch (error) {
            console.error('Could not update the raid counter:', error);
        }
    }

    // If this is swallowed silently and channel permissions depend on it, a new member sees everything unverified.
    let unverifiedFailed = false;
    if (restored !== 'restored' && config.unverifiedRoleId && !member.roles.cache.has(config.unverifiedRoleId)) {
        await member.roles.add(config.unverifiedRoleId).catch((error: unknown) => {
            unverifiedFailed = true;
            console.error(`Could not grant the unverified role (${member.id}):`, error);
        });
    }

    if (!config.joinLogChannelId) return;
    const user = member.user;
    const embed = card('MEMBER', {
        color: COLORS.ok,
        title: 'Joined the server',
        description: `${user}  ·  ${tag(user.id)}`,
        timestamp: Date.now(),
    })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
            { name: 'Account created', value: `${date(user.createdTimestamp)}  ·  ${ago(user.createdTimestamp)}`, inline: true },
            { name: 'Member count', value: String(member.guild.memberCount), inline: true },
        );

    if (user.bot) embed.addFields({ name: 'Account type', value: 'Bot', inline: true });
    if (user.globalName && user.globalName !== user.username) embed.addFields({ name: 'Display name', value: clip(user.globalName, 100), inline: true });

    if (restored === 'restored') {
        embed.addFields({ name: 'Verification', value: 'A previously verified member returned; roles were restored.' });
    } else if (restored === 'failed') {
        embed.setColor(COLORS.bad).addFields({
            name: 'Verification problem',
            value: 'A verified member returned but the roles could not be granted. Check the role hierarchy.',
        });
    }
    if (unverifiedFailed) {
        embed.setColor(COLORS.bad).addFields({
            name: 'Role problem',
            value: "The unverified role could not be granted. Make sure the bot's role is above it.",
        });
    }

    await sendJoinLog(member.guild, embed);
}
