import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import { getNotifier, getRaid, getService } from '../verification/runtime.mts';
import { runVerification } from '../verification/staff.mts';

const userOption = (sub: SlashCommandSubcommandBuilder) =>
    sub.addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true));

export const data = new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Manage web verification.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) => userOption(sub.setName('info').setDescription("Shows a member's verification status and recent attempts.")))
    .addSubcommand((sub) =>
        userOption(sub.setName('approve').setDescription('Skips the automatic checks, verifies the member manually and grants the verified role.')),
    )
    .addSubcommand((sub) =>
        userOption(sub.setName('reset').setDescription('Revokes the verification and clears the device lock; the member can verify again.'))
            .addBooleanOption((opt) => opt.setName('remove-roles').setDescription('Also remove the verified role (default: no)')),
    )
    .addSubcommand((sub) =>
        userOption(sub.setName('delete').setDescription('Erases all of a member\'s verification records (cannot be undone).'))
            .addBooleanOption((opt) => opt.setName('confirm').setDescription('I confirm the deletion').setRequired(true)),
    );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await runVerification(interaction, { service: getService(), raid: getRaid(), notifier: getNotifier() });
}
