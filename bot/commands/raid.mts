import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { getNotifier, getRaid, getService } from '../verification/runtime.mts';
import { runRaid } from '../verification/staff.mts';

export const data = new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Raid mode: while on, every verification is sent to manual review.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => sub.setName('status').setDescription('Shows the state of raid mode.'))
    .addSubcommand((sub) => sub.setName('on').setDescription('Enables raid mode manually (stays on until disabled).'))
    .addSubcommand((sub) => sub.setName('off').setDescription('Disables raid mode.'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await runRaid(interaction, { service: getService(), raid: getRaid(), notifier: getNotifier() });
}
