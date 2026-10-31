import type { GuildMember, PartialGuildMember } from 'discord.js';
import { config } from '../config.mts';
import { COLORS, ago, card, date, tag } from '../utils/style.mts';
import { sendJoinLog } from '../utils/serverLog.mts';
import { joinLimited } from '../utils/text.mts';
import { getService } from '../verification/runtime.mts';

export const name = 'guildMemberRemove';

export async function execute(member: GuildMember | PartialGuildMember): Promise<void> {
    if (config.guildId && member.guild.id !== config.guildId) return;

    // The retention period of the device link counts from the day the member left.
    try {
        getService()?.memberLeft(member.id);
    } catch (error) {
        console.error('Could not record the departure:', error);
    }

    if (!config.joinLogChannelId) return;
    // On a partial member the roles may not be cached.
    const roles = joinLimited(member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => `${r}`)) || 'None';

    const embed = card('MEMBER', {
        color: COLORS.info,
        title: 'Left the server',
        description: `${member.user}  ·  ${tag(member.user.id)}`,
        timestamp: Date.now(),
    })
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            ...(member.joinedTimestamp ? [{ name: 'Joined', value: `${date(member.joinedTimestamp)}  ·  ${ago(member.joinedTimestamp)}`, inline: true }] : []),
            { name: 'Roles', value: roles },
        );

    await sendJoinLog(member.guild, embed);
}
