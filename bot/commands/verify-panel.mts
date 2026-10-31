import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, SlashCommandBuilder,
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { config } from '../config.mts';
import { card } from '../utils/style.mts';
import { getService } from '../verification/runtime.mts';

export const data = new SlashCommandBuilder()
    .setName('verify-panel')
    .setDescription('Posts the verification panel in this channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

/** The panel posted in the verification channel (also used to render the README previews). */
export function panelMessage(webUrl: string) {
    const base = webUrl.replace(/\/+$/, '');
    const embed = card('VERIFY', {
        title: 'Server verification',
        description:
            'To get access to the server we need to confirm that your account is used by a real person. ' +
            'It takes about a minute.\n\n' +
            '`01`  Press the button below\n' +
            '`02`  Sign in with your Discord account\n' +
            '`03`  Complete the short security check\n\n' +
            'Your role is granted automatically once you pass.\n\n' +
            '*This keeps out alt accounts and bots. Your location, email and server list are never requested.*',
        footer: 'Powered by Zack',
    });
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel('Start verification').setStyle(ButtonStyle.Link).setURL(`${base}/verify`),
        new ButtonBuilder().setLabel('Privacy notice').setStyle(ButtonStyle.Link).setURL(`${base}/privacy`),
    );
    return { embeds: [embed], components: [row] };
}

// The button is a link that takes the person to the site; it does not create a bot interaction.
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!getService()) {
        await interaction.reply({ content: "The verification API is not running (check the bot log); the panel was not posted.", flags: ['Ephemeral'] });
        return;
    }
    if (!config.verifyWebUrl) {
        await interaction.reply({ content: 'VERIFY_WEB_URL is not set.', flags: ['Ephemeral'] });
        return;
    }

    const message = panelMessage(config.verifyWebUrl);

    try {
        if (!interaction.channel || !('send' in interaction.channel)) throw new Error('This channel cannot receive messages.');
        await interaction.channel.send(message);
        await interaction.reply({ content: 'The panel was posted in this channel.', flags: ['Ephemeral'] });
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'The panel could not be posted.', flags: ['Ephemeral'] }).catch(() => {});
    }
}
