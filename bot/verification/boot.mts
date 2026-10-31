import type { Server } from 'node:http';
import type { Client } from 'discord.js';
import { startApi } from '../api/server.mts';
import { RaidMonitor } from './raid.mts';
import { createDiscordPorts } from './roles.mts';
import { setNotifier, setRaid, setService } from './runtime.mts';
import { createDiscordNotifier } from './staff.mts';
import type { DiscordNotifier } from './staff.mts';
import { getMeta, setMeta } from './store.mts';
import { DEFAULT_SERVICE_CONFIG, createVerificationService } from './service.mts';
import type { Notifier, VerificationService } from './service.mts';
import type { IpFailMode } from './types.mts';

/** The verification-related part of the bot config. */
export interface BootConfig {
    guildId: string;
    verifiedRoleId: string | undefined;
    unverifiedRoleId: string | undefined;
    apiPort: number;
    apiHost?: string;
    apiSecret: string;
    hashPepper: string;
    deviceSecret: string;
    turnstileSecret: string;
    turnstileHostnames: string[];
    turnstileTestKeys: boolean;
    proxycheckKey: string | undefined;
    ipCheckFailMode: IpFailMode;
    minAccountAgeDays: number;
    riskReviewThreshold: number;
    riskBlockThreshold: number;
    retryPerHour: number;
    retryPerDay: number;
    verifyLogChannelId: string | undefined;
    verifyReviewChannelId: string | undefined;
    raidWindowSec: number;
    raidJoinCount: number;
    raidCalmMin: number;
    localeHint?: { country: string; language: string } | undefined;
}

export interface BootOptions {
    /** Tests: replaces the default Discord notifier. */
    notifier?: Notifier;
    /** Tests: 0 = pick a free port. */
    port?: number;
    host?: string;
    fetchImpl?: typeof fetch;
}

const PURGE_FIRST_RUN_MS = 60_000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RunningVerification {
    service: VerificationService;
    server: Server;
    raid: RaidMonitor;
    notifier: DiscordNotifier;
    stop(): Promise<void>;
}

/** Starts the verification service and the bot API. Call it once the Discord client is ready. */
export async function startVerification(
    client: Client, config: BootConfig, options: BootOptions = {},
): Promise<RunningVerification> {
    const discord = createDiscordPorts(client, config);
    const notifier = createDiscordNotifier(client, {
        logChannelId: config.verifyLogChannelId,
        reviewChannelId: config.verifyReviewChannelId,
    });

    const logQuietly = (promise: Promise<void>) => promise.catch((error: unknown) => console.error('Could not send log:', error));

    // Raid mode: state lives in the database, so it survives a bot restart.
    const raid = new RaidMonitor({
        windowMs: config.raidWindowSec * 1000,
        joinCount: config.raidJoinCount,
        calmMs: config.raidCalmMin * 60_000,
        load: () => {
            const saved = getMeta('raid');
            try {
                return saved ? JSON.parse(saved) : null;
            } catch {
                return null;
            }
        },
        save: (snapshot) => setMeta('raid', JSON.stringify(snapshot)),
        onChange: (active, info) => {
            const who = info.by === 'manual' ? `manually by <@${info.staffId ?? '?'}>` : 'automatically';
            logQuietly(
                notifier.raid(
                    active,
                    active
                        ? `New verifications are now sent to manual review. Enabled ${who}.` +
                              (info.by === 'auto' ? ` ${info.joins} joins in the last ${config.raidWindowSec}s.` : '')
                        : `Verifications are back to normal. Disabled ${who}.`,
                ),
            );
        },
    });
    setRaid(raid);
    setNotifier(notifier);

    const service = createVerificationService(
        {
            pepper: config.hashPepper,
            deviceSecret: config.deviceSecret,
            turnstileSecret: config.turnstileSecret,
            proxycheckKey: config.proxycheckKey,
            ipFailMode: config.ipCheckFailMode,
            minAccountAgeDays: config.minAccountAgeDays,
            reviewThreshold: config.riskReviewThreshold,
            blockThreshold: config.riskBlockThreshold,
            retryPerHour: config.retryPerHour,
            retryPerDay: config.retryPerDay,
            turnstileHostnames: config.turnstileHostnames,
            turnstileTestKeys: config.turnstileTestKeys,
            localeHint: config.localeHint,
            ...DEFAULT_SERVICE_CONFIG,
        },
        {
            now: Date.now,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            isMember: discord.isMember,
            roles: discord.roles,
            notifier: options.notifier ?? notifier,
            isRaid: () => raid.isActive(),
        },
    );
    setService(service);

    const server = await startApi(
        { service, secret: config.apiSecret, ready: () => client.isReady() },
        options.port ?? config.apiPort,
        options.host ?? config.apiHost,
    );

    // Privacy: clean up records whose retention period has passed, once a day.
    const runPurge = () => {
        try {
            const removed = service.purge();
            const total = Object.values(removed).reduce((a, b) => a + b, 0);
            if (total > 0) console.log('🧹 Expired verification records deleted:', removed);
        } catch (error) {
            console.error('Verification cleanup failed:', error);
        }
    };
    // Poll raid state regularly so the automatic switch-off after the calm period gets logged.
    const raidWatch = setInterval(() => raid.isActive(), 30_000);
    raidWatch.unref();

    const first = setTimeout(runPurge, PURGE_FIRST_RUN_MS);
    const daily = setInterval(runPurge, PURGE_INTERVAL_MS);
    first.unref();
    daily.unref();

    return {
        service,
        server,
        raid,
        notifier,
        stop: () =>
            new Promise<void>((resolve) => {
                clearTimeout(first);
                clearInterval(daily);
                clearInterval(raidWatch);
                setService(null);
                setRaid(null);
                setNotifier(null);
                server.close(() => resolve());
                server.closeAllConnections();
            }),
    };
}
