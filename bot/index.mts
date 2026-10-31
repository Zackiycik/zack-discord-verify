import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config, validate } from './config.mts';
import type { BotClient, BotCommand } from './types.mts';

// With bad settings the database is never touched.
validate();

const database = await import('./db.mts');

try {
    database.acquireInstanceLock();
} catch (error) {
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember, Partials.User],
}) as BotClient;

client.commands = new Collection<string, BotCommand>();

const load = async (dir: string) => {
    const base = path.join(import.meta.dirname, dir);
    const files = fs.readdirSync(base).filter((f) => f.endsWith('.mts'));
    return Promise.all(files.map((f) => import(pathToFileURL(path.join(base, f)).href)));
};

for (const command of (await load('commands')) as BotCommand[]) client.commands.set(command.data.name, command);

// An uncaught error inside one event no longer takes the bot down, it is just logged.
for (const event of (await load('events')) as {
    name: string; once?: boolean; execute: (...args: never[]) => unknown;
}[]) {
    const run = async (...args: unknown[]) => {
        try {
            await (event.execute as (...a: unknown[]) => unknown)(...args);
        } catch (error) {
            console.error(`Event error (${event.name}):`, error);
        }
    };
    if (event.once) client.once(event.name, run);
    else client.on(event.name, run);
}

// Without an 'error' listener Node throws the event and kills the process.
client.on('error', (error) => console.error('Client error:', error));
client.on('warn', (message) => console.warn('Client warning:', message));
client.on('shardError', (error) => console.error('Shard error:', error));

process.on('unhandledRejection', (reason) => console.error('Unhandled promise rejection:', reason));
process.on('uncaughtException', (error) => {
    console.error('Uncaught error, shutting down:', error);
    shutdown(1);
});

// On SIGINT/SIGTERM the database and the lock are released cleanly.
let shuttingDown = false;
function shutdown(code = 0): void {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        client.destroy();
    } catch {
        // connection already closed
    }
    database.close();
    process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

client.login(config.token).catch((error: Error) => {
    console.error('❌ Discord login failed (is TOKEN valid?):', error.message);
    shutdown(1);
});
