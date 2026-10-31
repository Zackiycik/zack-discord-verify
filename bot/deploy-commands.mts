import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REST, Routes } from 'discord.js';
import { config, validate } from './config.mts';

// Registers the slash commands for the configured server (instant, unlike global commands).
validate(['token', 'clientId', 'guildId']);

const dir = path.join(import.meta.dirname, 'commands');
const commands: unknown[] = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mts'))) {
    const command = (await import(pathToFileURL(path.join(dir, file)).href)) as { data: { toJSON(): unknown } };
    commands.push(command.data.toJSON());
}

const rest = new REST().setToken(config.token);
try {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`✅ Registered ${commands.length} commands.`);
} catch (error) {
    console.error('❌ Could not register commands (does the token belong to the bot with CLIENT_ID?):', (error as Error).message);
    process.exit(1);
}
