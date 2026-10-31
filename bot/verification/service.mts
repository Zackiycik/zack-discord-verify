import crypto from 'node:crypto';
import * as store from './store.mts';
import type { AttemptRow } from './store.mts';
import { decide } from './engine.mts';
import { hashValue, mintDeviceToken, normalizeIp, randomToken, sha256Hex, verifyDeviceToken } from './hash.mts';
import { accountSignals } from './checks/account.mts';
import { behaviorSignals } from './checks/behavior.mts';
import type { HeadlessFlags, InteractionCounts } from './checks/behavior.mts';
import { deviceSignals } from './checks/device.mts';
import { ipSignals, lookupProxycheck } from './checks/ipReputation.mts';
import type { IpLookupResult } from './checks/ipReputation.mts';
import { localeSignals } from './checks/locale.mts';
import { turnstileSignals, verifyTurnstile } from './checks/turnstile.mts';
import { LIMITS } from './weights.mts';
import { block } from './types.mts';
import type { Decision, IpFailMode, Signal } from './types.mts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface ServiceConfig {
    pepper: string;
    deviceSecret: string;
    turnstileSecret: string;
    proxycheckKey?: string | undefined;
    ipFailMode: IpFailMode;
    minAccountAgeDays: number;
    reviewThreshold: number;
    blockThreshold: number;
    retryPerHour: number;
    retryPerDay: number;
    ipSessionsPerHour: number;
    sessionTtlMs: number;
    resultTtlMs: number;
    ipCacheMs: number;
    turnstileAction: string;
    turnstileHostnames: string[];
    turnstileTestKeys?: boolean;
    /** Optional "expected browser language" rule, see checks/locale.mts. */
    localeHint?: { country: string; language: string } | undefined;
    attemptRetentionMs: number;
    deviceRetentionAfterLeaveMs: number;
}

export const DEFAULT_SERVICE_CONFIG = {
    ipSessionsPerHour: 30,
    sessionTtlMs: 10 * MINUTE,
    resultTtlMs: 15 * MINUTE,
    ipCacheMs: DAY,
    turnstileAction: 'verify',
    attemptRetentionMs: 90 * DAY,
    deviceRetentionAfterLeaveMs: 365 * DAY,
} as const;

export interface RoleResult {
    ok: boolean;
    error?: string | undefined;
}

/** Notifications must never break the flow: they are all optional and errors are swallowed. */
export interface Notifier {
    attemptRecorded?(attempt: AttemptRow, signals: Signal[]): void | Promise<void>;
    reviewRequested?(attempt: AttemptRow, signals: Signal[]): void | Promise<void>;
    rolesFailed?(attempt: AttemptRow, error: string): void | Promise<void>;
}

export interface ServicePorts {
    now(): number;
    fetchImpl?: typeof fetch;
    /** Is the person in the server? */
    isMember(discordId: string): Promise<boolean>;
    roles: {
        grant(discordId: string, reason: string): Promise<RoleResult>;
        revoke(discordId: string, reason: string): Promise<RoleResult>;
    };
    notifier: Notifier;
    isRaid(): boolean;
}

export interface DiscordUserInput {
    id: string;
    username: string;
    avatar: string | null;
    globalName: string | null;
    publicFlags: number;
    bot: boolean;
    system: boolean;
}

export interface NetworkInfo {
    ip: string;
    ipCountry: string | null;
    ipTimezone: string | null;
}

export interface SubmitInput extends NetworkInfo {
    sessionToken: string;
    turnstileToken: string;
    deviceToken: string | null;
    fingerprint: string;
    clientTz: string | null;
    clientLangs: string[];
    interactions: InteractionCounts;
    headless: HeadlessFlags;
}

export type CreateSessionResult =
    | { status: 'ok'; sessionToken: string }
    | { status: 'already_verified'; rolesOk: boolean }
    | { status: 'not_member' }
    | { status: 'bot' }
    | { status: 'rate_limited'; retryAfterSec: number };

export type SubmitResult =
    | { status: 'invalid_session' }
    | { status: 'done'; decision: Decision; deviceToken: string; resultToken: string };

export type ResultStatus =
    | 'invalid' | 'blocked' | 'verified' | 'manual' | 'rejected' | 'role_failed';

export type ReviewResult =
    | { status: 'not_found' | 'not_reviewable' }
    | { status: 'already_decided'; outcome: 'approved' | 'rejected' | null }
    | { status: 'approved'; rolesOk: boolean; error?: string | undefined }
    | { status: 'rejected' };

// Text from the client ends up in the staff channel and the database: its format is validated and anything odd is dropped.
const TZ_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;
const LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
export const cleanTimezone = (value: string | null | undefined): string | null =>
    value && TZ_PATTERN.test(value) ? value : null;
export const cleanLanguages = (values: string[]): string[] => values.filter((v) => LANG_PATTERN.test(v)).slice(0, 10);

export const parseSignals = (attempt: Pick<AttemptRow, 'signals'>): Signal[] => {
    try {
        return JSON.parse(attempt.signals) as Signal[];
    } catch {
        return [];
    }
};

export function createVerificationService(cfg: ServiceConfig, ports: ServicePorts) {
    const notify = async (fn: (() => void | Promise<void>) | undefined): Promise<void> => {
        try {
            await fn?.();
        } catch (error) {
            console.error('Could not send the verification notification:', error);
        }
    };

    // ---------------------------------------------------------------- oturum
    async function createSession(user: DiscordUserInput, network: NetworkInfo): Promise<CreateSessionResult> {
        // Bot accounts are rejected even if they show up in OAuth.
        if (user.bot || user.system) return { status: 'bot' };
        if (!(await ports.isMember(user.id))) return { status: 'not_member' };

        const t = ports.now();

        // Every Discord account is verified once: a returning member gets their roles back without any checks.
        const active = store.getActiveVerified(user.id);
        if (active) {
            const granted = await ports.roles.grant(user.id, 'Web verification: already verified');
            return { status: 'already_verified', rolesOk: granted.ok };
        }

        const wait = (windowMs: number, limit: number): number | null => {
            if (store.countSessions(user.id, t - windowMs) < limit) return null;
            const oldest = store.oldestSessionSince(user.id, t - windowMs) ?? t;
            return Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
        };
        const retryAfterSec = Math.max(wait(HOUR, cfg.retryPerHour) ?? 0, wait(DAY, cfg.retryPerDay) ?? 0);
        if (retryAfterSec > 0) return { status: 'rate_limited', retryAfterSec };

        // Opening a session without submitting costs no attempt, but opening sessions is not unlimited either.
        if (store.countAllSessions(user.id, t - HOUR) >= cfg.retryPerHour * 10) {
            return { status: 'rate_limited', retryAfterSec: 60 * 5 };
        }

        const ipHash = hashValue(cfg.pepper, 'ip', normalizeIp(network.ip));
        if (store.countSessionsByIp(ipHash, t - HOUR) >= cfg.ipSessionsPerHour) {
            return { status: 'rate_limited', retryAfterSec: 60 * 5 };
        }

        // Only one open session at a time: pre-opened sessions cannot be used to get around the retry limit.
        store.expirePendingSessions(user.id, t);

        const sessionToken = randomToken();
        store.insertSession({
            id: crypto.randomUUID(),
            token_hash: sha256Hex(sessionToken),
            discord_id: user.id,
            username: user.username.slice(0, 64),
            avatar: user.avatar,
            global_name: user.globalName,
            public_flags: user.publicFlags,
            ip_hash: ipHash,
            ip_country: network.ipCountry,
            ip_timezone: network.ipTimezone,
            created_at: t,
            expires_at: t + cfg.sessionTtlMs,
        });
        return { status: 'ok', sessionToken };
    }

    /** Called when the challenge page is opened; time on the page is measured on the SERVER from this moment. */
    function viewSession(
        sessionToken: string,
    ): { ok: false } | { ok: true; username: string; expiresInSec: number; cdata: string } {
        const t = ports.now();
        const session = store.markViewed(sha256Hex(sessionToken), t);
        if (!session) return { ok: false };
        return {
            ok: true,
            username: session.username,
            expiresInSec: Math.max(0, Math.floor((session.expires_at - t) / 1000)),
            // Passed to the Turnstile widget as cData: the captcha token is only valid for this session.
            cdata: session.id,
        };
    }

    // ---------------------------------------------------------------- IP
    async function lookupIp(ip: string, ipHash: string, t: number): Promise<IpLookupResult> {
        const cached = store.getIpCache(ipHash, t);
        if (cached) {
            try {
                return { ...(JSON.parse(cached) as IpLookupResult) };
            } catch {
                // corrupt cache entry: look it up again
            }
        }
        const result = await lookupProxycheck({ ip, apiKey: cfg.proxycheckKey, ...(ports.fetchImpl ? { fetchImpl: ports.fetchImpl } : {}) });
        // Failed and skipped lookups are not cached: they should be retried once the service recovers.
        if (result.ok && !result.skipped) store.setIpCache(ipHash, JSON.stringify(result), t + cfg.ipCacheMs);
        return result;
    }

    // ---------------------------------------------------------------- karar
    async function submit(input: SubmitInput): Promise<SubmitResult> {
        const t = ports.now();

        // Atomic consumption: a session is single use, repeated/parallel requests are rejected here.
        const session = store.consumeSession(sha256Hex(input.sessionToken), t);
        if (!session) return { status: 'invalid_session' };

        const discordId = session.discord_id;
        const ipHash = hashValue(cfg.pepper, 'ip', normalizeIp(input.ip));
        const clientTz = cleanTimezone(input.clientTz);
        const clientLangs = cleanLanguages(input.clientLangs);
        const signals: Signal[] = [];

        // 1) Captcha: verified server-side. If it fails, the expensive external lookups (IP service) are skipped.
        const turnstile = await verifyTurnstile({
            token: input.turnstileToken,
            secret: cfg.turnstileSecret,
            ip: input.ip,
            ...(ports.fetchImpl ? { fetchImpl: ports.fetchImpl } : {}),
        });
        const turnstileResult = turnstileSignals(turnstile, {
            action: cfg.turnstileAction,
            cdata: session.id,
            hostnames: cfg.turnstileHostnames,
            testKeys: cfg.turnstileTestKeys,
        });
        signals.push(...turnstileResult);
        const captchaFailed = turnstileResult.some((s) => s.kind === 'BLOCK');

        // 2) IP reputation
        let ipCountry = input.ipCountry;
        let ipTimezone = cleanTimezone(input.ipTimezone ?? session.ip_timezone);
        if (!captchaFailed) {
            const ip = await lookupIp(input.ip, ipHash, t);
            signals.push(...ipSignals(ip, cfg.ipFailMode));
            ipCountry = ip.info?.country ?? input.ipCountry;
            ipTimezone ??= cleanTimezone(ip.info?.timezone);
        }

        // 3) Device: the token is minted and signed by the server; if invalid, a new one is issued.
        const presentedId = verifyDeviceToken(cfg.deviceSecret, input.deviceToken);
        const deviceToken = presentedId && input.deviceToken ? input.deviceToken : mintDeviceToken(cfg.deviceSecret);
        const deviceId = presentedId ?? verifyDeviceToken(cfg.deviceSecret, deviceToken) ?? '';
        const deviceHash = hashValue(cfg.pepper, 'device', deviceId);
        const fingerprintHash = hashValue(cfg.pepper, 'fp', input.fingerprint.slice(0, 256));

        signals.push(
            ...deviceSignals({
                tokenValid: presentedId !== null,
                tokenOthers: presentedId ? store.countDeviceOthers('device', deviceHash, discordId) : 0,
                fingerprintOthers: store.countDeviceOthers('fp', fingerprintHash, discordId),
                ipRecentOthers: store.countIpOthers(ipHash, discordId, t - LIMITS.IP_SHARED_WINDOW_MS),
            }),
        );

        // Someone rejected by staff cannot get through by retrying (turning the VPN off, waiting) until they are reset.
        if (store.hasActiveRejection(discordId)) signals.push(block('PREVIOUSLY_REJECTED'));

        // 4) Account, locale and behaviour
        signals.push(
            ...accountSignals(
                { id: discordId, avatar: session.avatar, globalName: session.global_name, publicFlags: session.public_flags },
                { now: t, minAgeDays: cfg.minAccountAgeDays },
            ),
            ...localeSignals({
                clientTz,
                ipTz: ipTimezone,
                clientLangs,
                ipCountry,
                now: t,
                hint: cfg.localeHint,
            }),
            ...behaviorSignals({
                // The server, not the client, measures the time: challenge page viewed → now.
                elapsedMs: session.challenge_viewed_at === null ? null : t - session.challenge_viewed_at,
                interactions: input.interactions,
                headless: input.headless,
            }),
        );

        const verdict = decide(signals, {
            reviewThreshold: cfg.reviewThreshold,
            blockThreshold: cfg.blockThreshold,
            raidMode: ports.isRaid(),
        });

        const resultToken = randomToken();
        const attemptId = crypto.randomUUID();
        store.insertAttempt({
            id: attemptId,
            session_id: session.id,
            discord_id: discordId,
            username: session.username,
            ip_hash: ipHash,
            ip_country: ipCountry,
            device_id_hash: deviceHash,
            fingerprint_hash: fingerprintHash,
            client_tz: clientTz,
            client_lang: clientLangs.join(',').slice(0, 100),
            signals: JSON.stringify(verdict.signals),
            risk_score: verdict.score,
            decision: verdict.decision,
            reason_codes: JSON.stringify(verdict.reasons),
            result_token_hash: sha256Hex(resultToken),
            created_at: t,
            result_expires_at: t + cfg.resultTtlMs,
        });

        // The decision is applied immediately: approval grants the role, manual review posts a message with buttons for staff.
        let decision: Decision = verdict.decision;
        const attempt = store.getAttempt(attemptId);
        if (attempt && decision === 'approved') {
            const outcome = await finalize(attempt, 'auto');
            const fresh = store.getAttempt(attemptId) ?? attempt;
            if (outcome.raced) {
                decision = 'manual_review';
                await notify(() => ports.notifier.reviewRequested?.(fresh, parseSignals(fresh)));
            } else {
                await notify(() => ports.notifier.attemptRecorded?.(fresh, verdict.signals));
            }
        } else if (attempt && decision === 'manual_review') {
            await notify(() => ports.notifier.reviewRequested?.(attempt, verdict.signals));
        } else if (attempt) {
            await notify(() => ports.notifier.attemptRecorded?.(attempt, verdict.signals));
        }

        return { status: 'done', decision, deviceToken, resultToken };
    }

    // ---------------------------------------------------------------- rol
    /**
     * Writes the record and grants the roles. On automatic approval a final check guards against two accounts
     * passing from the same device at the same time: the database transaction is atomic, the second goes to manual review.
     */
    async function finalize(
        attempt: AttemptRow, method: 'auto' | 'manual',
    ): Promise<{ ok: boolean; raced?: boolean; error?: string | undefined }> {
        const t = ports.now();

        const raced = store.inTransaction(() => {
            if (method === 'auto') {
                const deviceTaken = attempt.device_id_hash
                    ? store.countDeviceOthers('device', attempt.device_id_hash, attempt.discord_id) > 0
                    : false;
                const fingerprintTaken = attempt.fingerprint_hash
                    ? store.countDeviceOthers('fp', attempt.fingerprint_hash, attempt.discord_id) > 0
                    : false;
                if (deviceTaken || fingerprintTaken) {
                    const reasons = JSON.parse(attempt.reason_codes) as string[];
                    reasons.push(deviceTaken ? 'DEVICE_RACE' : 'FP_RACE');
                    store.markDeviceRace(attempt.id, JSON.stringify(reasons));
                    return true;
                }
            }
            store.upsertVerified(attempt.discord_id, method, attempt.id, t);
            if (attempt.device_id_hash) store.upsertDevice('device', attempt.device_id_hash, attempt.discord_id, t);
            if (attempt.fingerprint_hash) store.upsertDevice('fp', attempt.fingerprint_hash, attempt.discord_id, t);
            return false;
        });
        if (raced) return { ok: false, raced: true };

        const granted = await ports.roles.grant(attempt.discord_id, `Web verification #${attempt.id.slice(0, 8)}`);
        store.setRoleStatus(attempt.id, granted.ok ? 'granted' : 'failed', granted.error ?? null);
        if (!granted.ok) {
            await notify(() => ports.notifier.rolesFailed?.(attempt, granted.error ?? 'bilinmiyor'));
        }
        return { ok: granted.ok, error: granted.error };
    }

    function getResult(resultToken: string): { status: ResultStatus } {
        const attempt = store.getAttemptByResultHash(sha256Hex(resultToken));
        if (!attempt) return { status: 'invalid' };

        if (attempt.decision === 'blocked') return { status: 'blocked' };
        if (attempt.review_outcome === 'rejected') return { status: 'rejected' };
        if (attempt.role_status === 'failed') return { status: 'role_failed' };
        if (attempt.role_status === 'granted') return { status: 'verified' };
        // If the pending attempt was closed with `/verification approve`, the person is verified.
        if (attempt.review_outcome === 'approved' && store.getActiveVerified(attempt.discord_id)) return { status: 'verified' };
        return { status: 'manual' };
    }

    // ---------------------------------------------------------------- staff decisions
    async function approveAttempt(attemptId: string, staffId: string, via: string, note: string | null = null): Promise<ReviewResult> {
        const attempt = store.getAttempt(attemptId);
        if (!attempt) return { status: 'not_found' };
        if (attempt.decision !== 'manual_review') return { status: 'not_reviewable' };

        // Atomic: if two staff click at once, only one makes the decision.
        const reviewed = store.reviewAttempt(attemptId, 'approved', staffId, via, note, ports.now());
        if (!reviewed) return { status: 'already_decided', outcome: attempt.review_outcome };

        store.logAction(staffId, via, 'approve', attempt.discord_id, attemptId, ports.now());
        const outcome = await finalize(reviewed, 'manual');
        return { status: 'approved', rolesOk: outcome.ok, error: outcome.error };
    }

    function rejectAttempt(attemptId: string, staffId: string, via: string, note: string | null = null): ReviewResult {
        const attempt = store.getAttempt(attemptId);
        if (!attempt) return { status: 'not_found' };
        if (attempt.decision !== 'manual_review') return { status: 'not_reviewable' };

        const reviewed = store.reviewAttempt(attemptId, 'rejected', staffId, via, note, ports.now());
        if (!reviewed) return { status: 'already_decided', outcome: attempt.review_outcome };

        store.logAction(staffId, via, 'reject', attempt.discord_id, attemptId, ports.now());
        return { status: 'rejected' };
    }

    /** Revokes the verification and clears the device lock; the person can verify from scratch. */
    async function resetUser(discordId: string, staffId: string, via: string, removeRoles: boolean): Promise<RoleResult | null> {
        store.revokeVerified(discordId, staffId, ports.now());
        store.logAction(staffId, via, 'reset', discordId, removeRoles ? 'roles removed' : null, ports.now());
        return removeRoles ? ports.roles.revoke(discordId, `Verification reset (${staffId})`) : null;
    }

    // ---------------------------------------------------------------- staff tools
    /** `/verification info`: a person's status, recent attempts and other accounts using the same device. */
    function describeUser(discordId: string) {
        return {
            verified: store.getVerified(discordId),
            attempts: store.recentAttempts(discordId, 5),
            sharedDevice: store.deviceOwners(discordId),
        };
    }

    /** Verifies manually, skipping the automatic checks (e.g. a trusted member on a VPN). */
    async function forceVerify(discordId: string, staffId: string, via: string): Promise<RoleResult> {
        const t = ports.now();
        // The device link is recorded too, so alts this person opens from the same device get caught.
        const last = store.recentAttempts(discordId, 1)[0];
        store.inTransaction(() => {
            store.upsertVerified(discordId, 'manual', last?.id ?? null, t);
            if (last?.device_id_hash) store.upsertDevice('device', last.device_id_hash, discordId, t);
            if (last?.fingerprint_hash) store.upsertDevice('fp', last.fingerprint_hash, discordId, t);
            store.closePendingReviews(discordId, staffId, via, t);
        });
        store.logAction(staffId, via, 'force-verify', discordId, null, t);
        const granted = await ports.roles.grant(discordId, `Manual verification (${staffId})`);
        // Count the last attempt's IP as a "verified account" IP, so an alt coming from the same IP is caught.
        if (last && last.decision !== 'blocked') store.setRoleStatus(last.id, granted.ok ? 'granted' : 'failed', granted.error ?? null);
        return granted;
    }

    /** Erasure request. Roles are left alone; only database records are deleted. */
    function deleteUser(discordId: string, staffId: string, via: string): Record<string, number> {
        const removed = store.deleteUserData(discordId);
        store.logAction(staffId, via, 'delete-data', discordId, JSON.stringify(removed), ports.now());
        return removed;
    }

    // ---------------------------------------------------------------- rejoin
    /** Gives a returning verified member their roles back without any checks. */
    async function restoreMember(discordId: string): Promise<'restored' | 'failed' | 'not_verified'> {
        const active = store.getActiveVerified(discordId);
        if (!active) return 'not_verified';
        store.markRejoined(discordId);
        const granted = await ports.roles.grant(discordId, 'Verified member returned');
        return granted.ok ? 'restored' : 'failed';
    }

    const memberLeft = (discordId: string): void => store.markLeft(discordId, ports.now());

    const purge = () =>
        store.purgeExpired(ports.now(), {
            sessionMs: DAY,
            attemptMs: cfg.attemptRetentionMs,
            deviceAfterLeaveMs: cfg.deviceRetentionAfterLeaveMs,
        });

    return {
        createSession, viewSession, submit, getResult,
        approveAttempt, rejectAttempt, resetUser, restoreMember, memberLeft, purge,
        describeUser, forceVerify, deleteUser,
    };
}

export type VerificationService = ReturnType<typeof createVerificationService>;
