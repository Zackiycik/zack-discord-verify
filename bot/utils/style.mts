import { EmbedBuilder } from 'discord.js';
import { config } from '../config.mts';
import { clip } from './text.mts';

// Shared look of every message the bot sends: no emoji, status is shown by colour and a short label.

export const COLORS = {
    /** Default neutral card (info, panel, logs). */
    base: config.embedColor,
    /** Pending / informational. */
    info: 0xfee75c,
    /** Approval, success. */
    ok: 0x57f287,
    /** Rejection, block, error. */
    bad: 0xed4245,
} as const;

/** Card with a section label: `card('REVIEW', { color, title, description })`. */
export function card(
    section: string,
    opts: { color?: number; title?: string; description?: string; footer?: string; timestamp?: number } = {},
): EmbedBuilder {
    const { color = COLORS.base, title, description, footer, timestamp } = opts;
    const embed = new EmbedBuilder().setColor(color).setAuthor({ name: `${config.brandName}  /  ${section}` });
    if (title) embed.setTitle(clip(title, 256));
    if (description) embed.setDescription(clip(description, 4000));
    if (footer) embed.setFooter({ text: clip(footer, 200) });
    if (timestamp) embed.setTimestamp(timestamp);
    return embed;
}

/** Small inline label (e.g. a status or a signal kind). */
export const tag = (text: string): string => `\`${text}\``;

/** Discord timestamps. */
const seconds = (ms: number): number => Math.floor(ms / 1000);
export const ago = (ms: number): string => `<t:${seconds(ms)}:R>`;
export const date = (ms: number): string => `<t:${seconds(ms)}:D>`;

/** Keeps mentions inside message content from pinging anyone. */
export const NO_PINGS = { parse: [] as never[] };
