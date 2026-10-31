import type { EmbedBuilder, Guild } from 'discord.js';
import { config } from '../config.mts';

export async function sendJoinLog(guild: Guild, embed: EmbedBuilder): Promise<void> {
    if (!config.joinLogChannelId) return;
    const channel = guild.channels.cache.get(config.joinLogChannelId);
    if (!channel || !('send' in channel)) return;
    await channel.send({ embeds: [embed] }).catch((e: unknown) => console.error('Could not send log:', e));
}
