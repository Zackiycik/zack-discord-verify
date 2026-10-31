import type { ChatInputCommandInteraction, Client, Collection, SlashCommandOptionsOnlyBuilder } from 'discord.js';

export interface BotCommand {
    data: { name: string; toJSON(): unknown } | SlashCommandOptionsOnlyBuilder;
    execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export type BotClient = Client & { commands: Collection<string, BotCommand> };
