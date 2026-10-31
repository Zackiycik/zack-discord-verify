import type { Interaction } from 'discord.js';
import { config } from '../config.mts';
import type { BotClient } from '../types.mts';
import { getService } from '../verification/runtime.mts';
import { handleVerifyButton } from '../verification/staff.mts';

export const name = 'interactionCreate';

async function replyError(interaction: Interaction, content: string): Promise<void> {
    if (!interaction.isRepliable()) return;
    const payload = { content, flags: ['Ephemeral' as const] };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
}

export async function execute(interaction: Interaction): Promise<void> {
    // Only handle interactions from the configured server.
    if (interaction.guildId && config.guildId && interaction.guildId !== config.guildId) return;

    if (interaction.isChatInputCommand()) {
        const command = (interaction.client as BotClient).commands.get(interaction.commandName);
        if (!command) return;
        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            await replyError(interaction, 'Something went wrong while running the command.');
        }
        return;
    }

    // Manual-review buttons (Approve / Reject / Info in the staff channel).
    if (interaction.isButton() && interaction.customId.startsWith('vrf:')) {
        try {
            await handleVerifyButton(interaction, getService());
        } catch (error) {
            console.error('Verification button error:', error);
            await replyError(interaction, 'Something went wrong.');
        }
    }
}
