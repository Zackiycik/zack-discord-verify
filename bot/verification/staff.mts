import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} from 'discord.js';
import type { ButtonInteraction, ChatInputCommandInteraction, Client } from 'discord.js';
import { isStaff } from '../utils/staff.mts';
import { COLORS as PALETTE, NO_PINGS, card, tag } from '../utils/style.mts';
import { clip, joinLimited } from '../utils/text.mts';
import { signalLabel, signalLine } from './labels.mts';
import { parseSignals } from './service.mts';
import type { Notifier, VerificationService } from './service.mts';
import type { RaidMonitor } from './raid.mts';
import type { AttemptRow, VerifiedRow } from './store.mts';
import * as store from './store.mts';
import type { Signal } from './types.mts';

const COLORS = { approved: PALETTE.ok, manual_review: PALETTE.info, blocked: PALETTE.bad, neutral: PALETTE.base } as const;
const DECISION_TAG = { approved: 'APPROVED', manual_review: 'REVIEW', blocked: 'BLOCKED' } as const;
const DECISION_TITLE = {
    approved: 'Verification approved',
    manual_review: 'Verification awaiting review',
    blocked: 'Verification blocked',
} as const;
const ts = (ms: number): string => `<t:${Math.floor(ms / 1000)}:R>`;

// ---------------------------------------------------------------- embeds (pure functions)

export function formatSignals(signals: Signal[]): string {
    if (signals.length === 0) return 'No suspicious signals';
    return joinLimited(signals.map(signalLine), '\n');
}

export function attemptEmbed(attempt: AttemptRow, signals: Signal[]): EmbedBuilder {
    const embed = card(DECISION_TAG[attempt.decision], {
        color: COLORS[attempt.decision],
        title: DECISION_TITLE[attempt.decision],
        description: `<@${attempt.discord_id}>${attempt.username ? `  ·  ${clip(attempt.username, 40)}` : ''}`,
        footer: `Attempt ${attempt.id.slice(0, 8)}  ·  ${attempt.discord_id}`,
        timestamp: attempt.created_at,
    }).addFields(
        { name: 'Risk score', value: `**${attempt.risk_score}**`, inline: true },
        { name: 'Country', value: attempt.ip_country ?? 'Unknown', inline: true },
        { name: 'Browser', value: clip(`${attempt.client_tz ?? '?'}\n${attempt.client_lang ?? '?'}`, 200), inline: true },
        { name: 'Signals', value: formatSignals(signals) },
    );
    if (attempt.role_status === 'failed') {
        embed.addFields({ name: 'Roles could not be granted', value: clip(attempt.role_error ?? 'unknown', 500) });
    }
    return embed;
}

export function userInfoEmbed(
    discordId: string,
    info: { verified: VerifiedRow | undefined; attempts: AttemptRow[]; sharedDevice: string[] },
): EmbedBuilder {
    const { verified, attempts, sharedDevice } = info;
    const status = !verified
        ? 'Not verified'
        : verified.revoked_at
          ? `Revoked ${ts(verified.revoked_at)}`
          : `${verified.method === 'legacy' ? 'Imported' : verified.method === 'manual' ? 'Manually approved' : 'Automatic'}` +
            `  ·  ${ts(verified.verified_at)}` +
            `${verified.left_at ? `  ·  left the server ${ts(verified.left_at)}` : ''}`;

    const attemptLines = attempts.map(
        (a) =>
            `${ts(a.created_at)}  ${tag(DECISION_TAG[a.decision])}  score ${a.risk_score}` +
            `${a.review_outcome ? `  ·  staff: ${a.review_outcome === 'approved' ? 'approved' : 'rejected'}` : ''}` +
            `\n${joinLimited((JSON.parse(a.reason_codes) as string[]).map(signalLabel), '  ·  ', 300) || 'none'}`,
    );

    return card('VERIFICATION', { title: 'Verification info', description: `<@${discordId}>  ·  ${tag(discordId)}` }).addFields(
        { name: 'Status', value: status },
        { name: `Recent attempts (${attempts.length})`, value: attemptLines.length ? joinLimited(attemptLines, '\n\n') : 'No records' },
        { name: 'Other accounts on the same device', value: sharedDevice.length ? joinLimited(sharedDevice.map((id) => `<@${id}>  ${tag(id)}`), '\n') : 'None' },
    );
}

export function reviewButtons(attempt: AttemptRow): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`vrf:approve:${attempt.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`vrf:reject:${attempt.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`vrf:info:${attempt.discord_id}`).setLabel('Info').setStyle(ButtonStyle.Secondary),
    );
}

// ---------------------------------------------------------------- notifications

export interface NotifierChannels {
    logChannelId: string | undefined;
    reviewChannelId: string | undefined;
}

export type DiscordNotifier = Notifier & { staffAction(text: string): Promise<void>; raid(active: boolean, text: string): Promise<void> };

/** Posts to the staff channels (log / review). Falls back to the console if a channel is missing; never breaks the flow. */
export function createDiscordNotifier(client: Client, channels: NotifierChannels): DiscordNotifier {
    const channelOf = (id: string | undefined) => {
        const ch = id ? client.channels.cache.get(id) : undefined;
        return ch && 'send' in ch ? ch : undefined;
    };
    const log = () => channelOf(channels.logChannelId);
    const review = () => channelOf(channels.reviewChannelId) ?? log();

    return {
        async attemptRecorded(attempt, signals) {
            const ch = log();
            if (!ch) return console.warn(`Verification log: no channel configured (${attempt.discord_id}: ${attempt.decision})`);
            await ch.send({ embeds: [attemptEmbed(attempt, signals)], allowedMentions: NO_PINGS });
        },

        async reviewRequested(attempt, signals) {
            const ch = review();
            if (!ch) return console.warn(`Awaiting manual review but no channel is configured: ${attempt.id}`);
            const message = await ch.send({
                embeds: [attemptEmbed(attempt, signals)],
                components: [reviewButtons(attempt)],
                allowedMentions: NO_PINGS,
            });
            store.setLogMessage(attempt.id, message.id);
        },

        async rolesFailed(attempt, error) {
            const ch = log();
            const text = `<@${attempt.discord_id}> was verified but the roles could not be granted: ${clip(error, 300)}\nIs the bot's role above the verification roles? Once fixed, run \`/verification approve\` to grant them.`;
            if (!ch) return console.warn(text);
            await ch.send({ embeds: [card('VERIFICATION', { color: PALETTE.bad, title: 'Roles could not be granted', description: text })], allowedMentions: NO_PINGS });
        },

        async staffAction(text) {
            await log()?.send({ content: clip(text, 1800), allowedMentions: NO_PINGS });
        },

        async raid(active, text) {
            const ch = log();
            if (!ch) return console.warn(text);
            await ch.send({
                embeds: [card('RAID', { color: active ? PALETTE.bad : PALETTE.ok, title: active ? 'Raid mode enabled' : 'Raid mode disabled', description: text })],
                allowedMentions: NO_PINGS,
            });
        },
    };
}

// ---------------------------------------------------------------- buttons

const deny = (interaction: ButtonInteraction | ChatInputCommandInteraction, content: string) =>
    interaction.reply({ content, flags: ['Ephemeral'] });

const REVIEW_TEXT = {
    not_found: 'This attempt was not found (it may have expired and been deleted).',
    not_reviewable: 'This attempt does not need manual review.',
} as const;

/** `vrf:approve:<id>`, `vrf:reject:<id>`, `vrf:info:<discordId>` */
export async function handleVerifyButton(
    interaction: ButtonInteraction, service: VerificationService | null,
): Promise<void> {
    const [, action, arg] = interaction.customId.split(':');
    if (!arg) return void (await deny(interaction, 'Invalid button.'));

    // The button may be visible to everyone, but only staff can decide.
    if (!isStaff(interaction.member)) return void (await deny(interaction, 'You are not allowed to do this.'));
    if (!service) return void (await deny(interaction, 'The verification service is not running.'));

    if (action === 'info') {
        await interaction.reply({ embeds: [userInfoEmbed(arg, service.describeUser(arg))], flags: ['Ephemeral'], allowedMentions: NO_PINGS });
        return;
    }
    if (action !== 'approve' && action !== 'reject') return void (await deny(interaction, 'Invalid button.'));

    await interaction.deferUpdate();
    const staffId = interaction.user.id;
    const result = action === 'approve' ? await service.approveAttempt(arg, staffId, 'discord') : service.rejectAttempt(arg, staffId, 'discord');

    const original = interaction.message.embeds[0];
    const stamp = (verb: string, color: number, extra?: { name: string; value: string }) => {
        const embed = original ? EmbedBuilder.from(original) : new EmbedBuilder();
        embed.setColor(color).addFields({ name: verb, value: `<@${staffId}>  ·  ${ts(Date.now())}` });
        if (extra) embed.addFields(extra);
        return embed;
    };

    switch (result.status) {
        case 'approved':
            await interaction.message.edit({
                embeds: [stamp('Approved', COLORS.approved, result.rolesOk ? undefined : { name: 'Roles could not be granted', value: clip(result.error ?? 'unknown', 500) })],
                components: [],
                allowedMentions: NO_PINGS,
            });
            break;
        case 'rejected':
            await interaction.message.edit({ embeds: [stamp('Rejected', COLORS.blocked)], components: [], allowedMentions: NO_PINGS });
            break;
        case 'already_decided':
            // Another staff member was faster: remove the buttons so nobody acts twice.
            await interaction.message.edit({ components: [] }).catch(() => {});
            await interaction.followUp({
                content: `This attempt was already ${result.outcome === 'approved' ? 'approved' : 'rejected'}.`,
                flags: ['Ephemeral'],
            });
            break;
        default:
            await interaction.followUp({ content: `${REVIEW_TEXT[result.status]}`, flags: ['Ephemeral'] });
    }
}

// ---------------------------------------------------------------- /verification and /raid

export interface CommandDeps {
    service: VerificationService | null;
    raid: RaidMonitor | null;
    notifier: DiscordNotifier | null;
}

const ok = (interaction: ChatInputCommandInteraction, content: string) =>
    interaction.reply({ content, flags: ['Ephemeral'], allowedMentions: NO_PINGS });

export async function runVerification(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
    if (!isStaff(interaction.member)) return void (await deny(interaction, 'You are not allowed to use this command.'));
    const { service } = deps;
    if (!service) return void (await deny(interaction, 'The verification service is not running.'));

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user', true);
    const staff = interaction.user;

    if (target.bot) return void (await deny(interaction, 'Bot accounts are not verified.'));

    const record = (text: string) => deps.notifier?.staffAction(`${staff} → ${text}`).catch(() => {});

    switch (sub) {
        case 'info':
            await interaction.reply({
                embeds: [userInfoEmbed(target.id, service.describeUser(target.id))],
                flags: ['Ephemeral'],
                allowedMentions: NO_PINGS,
            });
            return;

        case 'approve': {
            await interaction.deferReply({ flags: ['Ephemeral'] });
            const result = await service.forceVerify(target.id, staff.id, 'discord');
            await record(`\`/verification approve\` ${target} - ${result.ok ? 'role granted' : `role failed: ${result.error}`}`);
            await interaction.editReply({
                content: result.ok
                    ? `${target} was verified manually and received the verified role.`
                    : `${target} was marked as verified but the roles could not be granted: ${result.error}`,
                allowedMentions: NO_PINGS,
            });
            return;
        }

        case 'reset': {
            await interaction.deferReply({ flags: ['Ephemeral'] });
            const removeRoles = interaction.options.getBoolean('remove-roles') ?? false;
            const result = await service.resetUser(target.id, staff.id, 'discord', removeRoles);
            await record(`\`/verification reset\` ${target}${removeRoles ? ' (roles removed)' : ''}`);
            await interaction.editReply({
                content:
                    `${target}'s verification was revoked and the device lock cleared.` +
                    (removeRoles ? (result?.ok ? ' Roles were removed.' : ` Roles could not be removed: ${result?.error}`) : ' Their roles were left unchanged.'),
                allowedMentions: NO_PINGS,
            });
            return;
        }

        case 'delete': {
            // Irreversible: explicit confirmation required.
            if (!interaction.options.getBoolean('confirm', true)) {
                return void (await deny(interaction, 'Set `confirm` to `True` to delete. This cannot be undone.'));
            }
            const removed = service.deleteUser(target.id, staff.id, 'discord');
            await record(`\`/verification delete\` ${target} (data erasure)`);
            await ok(
                interaction,
                `Verification records for ${target} were deleted: ${Object.entries(removed).map(([k, v]) => `${k}=${v}`).join(', ')}.\nTheir roles were left unchanged.`,
            );
            return;
        }

        default:
            await deny(interaction, 'Unknown subcommand.');
    }
}

export async function runRaid(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
    if (!isStaff(interaction.member)) return void (await deny(interaction, 'You are not allowed to use this command.'));
    const { raid } = deps;
    if (!raid) return void (await deny(interaction, 'The raid monitor is not running.'));

    const sub = interaction.options.getSubcommand();
    if (sub === 'on') raid.enable(interaction.user.id);
    else if (sub === 'off') raid.disable(interaction.user.id);

    const s = raid.status();
    await ok(
        interaction,
        `${s.active ? 'Raid mode is **ON**' : 'Raid mode is **off**'}${s.active ? (s.manual ? ' (enabled manually, stays on until disabled)' : ` (automatic, switches off after ${s.calmMin} calm minutes)`) : ''}\n` +
            `Joins in the last ${s.windowSec}s: **${s.joinsInWindow}** / threshold ${s.joinCount}`,
    );
}
