import { db, inTransaction } from '../db.mts';

// All SQL lives here; the business logic (service.mts) never touches the database directly.

export { inTransaction };

export interface SessionRow {
    id: string;
    token_hash: string;
    discord_id: string;
    username: string;
    avatar: string | null;
    global_name: string | null;
    public_flags: number;
    ip_hash: string | null;
    ip_country: string | null;
    ip_timezone: string | null;
    status: 'pending' | 'consumed';
    created_at: number;
    challenge_viewed_at: number | null;
    expires_at: number;
    consumed_at: number | null;
}

export interface AttemptRow {
    id: string;
    session_id: string | null;
    discord_id: string;
    username: string;
    ip_hash: string | null;
    ip_country: string | null;
    device_id_hash: string | null;
    fingerprint_hash: string | null;
    client_tz: string | null;
    client_lang: string | null;
    signals: string;
    risk_score: number;
    decision: 'approved' | 'manual_review' | 'blocked';
    reason_codes: string;
    role_status: 'n/a' | 'granted' | 'failed';
    role_error: string | null;
    review_outcome: 'approved' | 'rejected' | null;
    reviewed_by: string | null;
    reviewed_via: string | null;
    reviewed_at: number | null;
    review_note: string | null;
    log_message_id: string | null;
    result_token_hash: string | null;
    created_at: number;
    result_expires_at: number;
}

export interface VerifiedRow {
    discord_id: string;
    method: 'auto' | 'manual' | 'legacy';
    attempt_id: string | null;
    verified_at: number;
    left_at: number | null;
    revoked_at: number | null;
    revoked_by: string | null;
}

// node:sqlite rows are plain objects whose field names match the schema one to one.
const one = <T,>(row: unknown): T | undefined => (row ?? undefined) as T | undefined;
const all = <T,>(rows: unknown): T[] => rows as T[];
const count = (row: unknown): number => Number((row as { n: number }).n);

const q = {
    insertSession: db.prepare(
        `INSERT INTO verification_sessions
            (id, token_hash, discord_id, username, avatar, global_name, public_flags,
             ip_hash, ip_country, ip_timezone, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ),
    markViewed: db.prepare(
        `UPDATE verification_sessions
            SET challenge_viewed_at = COALESCE(challenge_viewed_at, ?)
          WHERE token_hash = ? AND status = 'pending' AND expires_at > ?
          RETURNING *`,
    ),
    consumeSession: db.prepare(
        `UPDATE verification_sessions SET status = 'consumed', consumed_at = ?
          WHERE token_hash = ? AND status = 'pending' AND expires_at > ?
          RETURNING *`,
    ),
    // The retry allowance only counts sessions that were actually submitted (consumed): someone who
    // refreshes the page or abandons OAuth halfway does not lose an attempt.
    countSessions: db.prepare(
        `SELECT COUNT(*) AS n FROM verification_sessions
          WHERE discord_id = ? AND status = 'consumed' AND consumed_at > ?`,
    ),
    oldestSession: db.prepare(
        `SELECT MIN(consumed_at) AS t FROM verification_sessions
          WHERE discord_id = ? AND status = 'consumed' AND consumed_at > ?`,
    ),
    // Closes the person's open sessions: only one session at a time, so the retry limit cannot be bypassed with parallel sessions.
    expirePending: db.prepare(
        `UPDATE verification_sessions SET expires_at = ?
          WHERE discord_id = ? AND status = 'pending' AND expires_at > ?`,
    ),
    countAllSessions: db.prepare(
        'SELECT COUNT(*) AS n FROM verification_sessions WHERE discord_id = ? AND created_at > ?',
    ),
    countSessionsByIp: db.prepare(
        'SELECT COUNT(*) AS n FROM verification_sessions WHERE ip_hash = ? AND created_at > ?',
    ),

    insertAttempt: db.prepare(
        `INSERT INTO verification_attempts
            (id, session_id, discord_id, username, ip_hash, ip_country, device_id_hash, fingerprint_hash,
             client_tz, client_lang, signals, risk_score, decision, reason_codes,
             result_token_hash, created_at, result_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getAttempt: db.prepare('SELECT * FROM verification_attempts WHERE id = ?'),
    getAttemptByResult: db.prepare('SELECT * FROM verification_attempts WHERE result_token_hash = ?'),
    setRoleStatus: db.prepare('UPDATE verification_attempts SET role_status = ?, role_error = ? WHERE id = ?'),
    setLogMessage: db.prepare('UPDATE verification_attempts SET log_message_id = ? WHERE id = ?'),
    markRace: db.prepare(
        `UPDATE verification_attempts SET decision = 'manual_review', reason_codes = ? WHERE id = ?`,
    ),
    review: db.prepare(
        `UPDATE verification_attempts
            SET review_outcome = ?, reviewed_by = ?, reviewed_via = ?, reviewed_at = ?, review_note = ?
          WHERE id = ? AND decision = 'manual_review' AND review_outcome IS NULL
          RETURNING *`,
    ),
    // A staff rejection stays in force until the person is cleared with `reset` or `force-verify`.
    hasRejection: db.prepare(
        `SELECT COUNT(*) AS n FROM verification_attempts
          WHERE discord_id = ? AND review_outcome = 'rejected'
            AND reviewed_at > COALESCE((SELECT MAX(created_at) FROM admin_actions
                                         WHERE target = ? AND action IN ('reset', 'force-verify')), 0)`,
    ),
    closeReviews: db.prepare(
        `UPDATE verification_attempts
            SET review_outcome = 'approved', reviewed_by = ?, reviewed_via = ?, reviewed_at = ?,
                review_note = 'verified manually'
          WHERE discord_id = ? AND decision = 'manual_review' AND review_outcome IS NULL`,
    ),
    recentForUser: db.prepare(
        'SELECT * FROM verification_attempts WHERE discord_id = ? ORDER BY created_at DESC LIMIT ?',
    ),
    countIpOthers: db.prepare(
        `SELECT COUNT(DISTINCT discord_id) AS n FROM verification_attempts
          WHERE ip_hash = ? AND discord_id != ? AND role_status = 'granted' AND created_at > ?`,
    ),

    getVerified: db.prepare('SELECT * FROM verified_accounts WHERE discord_id = ?'),
    upsertVerified: db.prepare(
        `INSERT INTO verified_accounts (discord_id, method, attempt_id, verified_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(discord_id) DO UPDATE SET
            method = excluded.method, attempt_id = excluded.attempt_id,
            verified_at = excluded.verified_at, left_at = NULL, revoked_at = NULL, revoked_by = NULL`,
    ),
    setLeft: db.prepare('UPDATE verified_accounts SET left_at = ? WHERE discord_id = ?'),
    clearLeft: db.prepare('UPDATE verified_accounts SET left_at = NULL WHERE discord_id = ?'),
    revoke: db.prepare(
        'UPDATE verified_accounts SET revoked_at = ?, revoked_by = ? WHERE discord_id = ? AND revoked_at IS NULL',
    ),
    deleteDevices: db.prepare('DELETE FROM device_identifiers WHERE discord_id = ?'),

    // "Other active account": a verified account that is neither revoked nor imported ('legacy').
    countDeviceOthers: db.prepare(
        `SELECT COUNT(DISTINCT d.discord_id) AS n
           FROM device_identifiers d
           JOIN verified_accounts v ON v.discord_id = d.discord_id
          WHERE d.type = ? AND d.hash = ? AND d.discord_id != ?
            AND v.revoked_at IS NULL AND v.method != 'legacy'`,
    ),
    deviceOwners: db.prepare(
        `SELECT DISTINCT d.discord_id AS discord_id
           FROM device_identifiers d
           JOIN verified_accounts v ON v.discord_id = d.discord_id
          WHERE d.type IN ('device','fp') AND d.hash IN (
                SELECT hash FROM device_identifiers WHERE discord_id = ?)
            AND d.discord_id != ? AND v.revoked_at IS NULL`,
    ),
    upsertDevice: db.prepare(
        `INSERT INTO device_identifiers (type, hash, discord_id, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(type, hash, discord_id) DO UPDATE SET last_seen = excluded.last_seen`,
    ),

    getIpCache: db.prepare('SELECT result FROM ip_cache WHERE ip_hash = ? AND expires_at > ?'),
    setIpCache: db.prepare(
        `INSERT INTO ip_cache (ip_hash, result, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET result = excluded.result, expires_at = excluded.expires_at`,
    ),

    getMeta: db.prepare('SELECT value FROM meta WHERE key = ?'),
    setMeta: db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ),

    logAction: db.prepare(
        'INSERT INTO admin_actions (staff_id, via, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
};

// --- oturumlar ---
export const insertSession = (s: Omit<SessionRow, 'status' | 'challenge_viewed_at' | 'consumed_at'>): void => {
    q.insertSession.run(
        s.id, s.token_hash, s.discord_id, s.username, s.avatar, s.global_name, s.public_flags,
        s.ip_hash, s.ip_country, s.ip_timezone, s.created_at, s.expires_at,
    );
};
export const markViewed = (tokenHash: string, now: number): SessionRow | undefined =>
    one<SessionRow>(q.markViewed.get(now, tokenHash, now));
/** Atomic: a session cannot be consumed twice (single use). */
export const consumeSession = (tokenHash: string, now: number): SessionRow | undefined =>
    one<SessionRow>(q.consumeSession.get(now, tokenHash, now));
export const countSessions = (discordId: string, since: number): number => count(q.countSessions.get(discordId, since));
export const oldestSessionSince = (discordId: string, since: number): number | null =>
    ((q.oldestSession.get(discordId, since) as { t: number | null }).t) ?? null;
export const expirePendingSessions = (discordId: string, now: number): void => {
    q.expirePending.run(now, discordId, now);
};
export const countAllSessions = (discordId: string, since: number): number =>
    count(q.countAllSessions.get(discordId, since));
export const countSessionsByIp = (ipHash: string, since: number): number => count(q.countSessionsByIp.get(ipHash, since));

// --- denemeler ---
export const insertAttempt = (
    a: Pick<AttemptRow,
        'id' | 'session_id' | 'discord_id' | 'username' | 'ip_hash' | 'ip_country' | 'device_id_hash' |
        'fingerprint_hash' | 'client_tz' | 'client_lang' | 'signals' | 'risk_score' | 'decision' |
        'reason_codes' | 'result_token_hash' | 'created_at' | 'result_expires_at'>,
): void => {
    q.insertAttempt.run(
        a.id, a.session_id, a.discord_id, a.username, a.ip_hash, a.ip_country, a.device_id_hash,
        a.fingerprint_hash, a.client_tz, a.client_lang, a.signals, a.risk_score, a.decision,
        a.reason_codes, a.result_token_hash, a.created_at, a.result_expires_at,
    );
};
export const getAttempt = (id: string): AttemptRow | undefined => one<AttemptRow>(q.getAttempt.get(id));
export const getAttemptByResultHash = (hash: string): AttemptRow | undefined =>
    one<AttemptRow>(q.getAttemptByResult.get(hash));
export const setRoleStatus = (id: string, status: AttemptRow['role_status'], error: string | null): void => {
    q.setRoleStatus.run(status, error, id);
};
export const setLogMessage = (id: string, messageId: string): void => {
    q.setLogMessage.run(messageId, id);
};
export const markDeviceRace = (id: string, reasonCodes: string): void => {
    q.markRace.run(reasonCodes, id);
};
/** Atomic: an attempt is decided only once (if two staff click at the same time, one loses). */
export const reviewAttempt = (
    id: string, outcome: 'approved' | 'rejected', staffId: string, via: string, note: string | null, now: number,
): AttemptRow | undefined => one<AttemptRow>(q.review.get(outcome, staffId, via, now, note, id));
export const hasActiveRejection = (discordId: string): boolean =>
    count(q.hasRejection.get(discordId, discordId)) > 0;
/** Closes pending manual reviews of a manually verified person (buttons left open will say "already decided"). */
export const closePendingReviews = (discordId: string, staffId: string, via: string, now: number): void => {
    q.closeReviews.run(staffId, via, now, discordId);
};
export const recentAttempts = (discordId: string, limit = 5): AttemptRow[] =>
    all<AttemptRow>(q.recentForUser.all(discordId, limit));
export const countIpOthers = (ipHash: string, discordId: string, since: number): number =>
    count(q.countIpOthers.get(ipHash, discordId, since));

// --- verified accounts ---
export const getVerified = (discordId: string): VerifiedRow | undefined => one<VerifiedRow>(q.getVerified.get(discordId));
/** The "active verification" that can be restored: not revoked and not imported. */
export const getActiveVerified = (discordId: string): VerifiedRow | undefined => {
    const row = getVerified(discordId);
    return row && row.revoked_at === null && row.method !== 'legacy' ? row : undefined;
};
export const upsertVerified = (
    discordId: string, method: VerifiedRow['method'], attemptId: string | null, now: number,
): void => {
    q.upsertVerified.run(discordId, method, attemptId, now);
};
export const markLeft = (discordId: string, now: number): void => {
    q.setLeft.run(now, discordId);
};
export const markRejoined = (discordId: string): void => {
    q.clearLeft.run(discordId);
};
/** Revokes the verification and clears the device lock (for someone wrongly blocked or whose alt was found). */
export const revokeVerified = (discordId: string, staffId: string, now: number): void => {
    inTransaction(() => {
        q.revoke.run(now, staffId, discordId);
        q.deleteDevices.run(discordId);
    });
};

// --- cihaz ---
export const countDeviceOthers = (type: 'device' | 'fp', hash: string, discordId: string): number =>
    count(q.countDeviceOthers.get(type, hash, discordId));
export const deviceOwners = (discordId: string): string[] =>
    all<{ discord_id: string }>(q.deviceOwners.all(discordId, discordId)).map((r) => r.discord_id);
export const upsertDevice = (type: 'device' | 'fp', hash: string, discordId: string, now: number): void => {
    q.upsertDevice.run(type, hash, discordId, now, now);
};

// --- IP cache ---
export const getIpCache = (ipHash: string, now: number): string | undefined =>
    one<{ result: string }>(q.getIpCache.get(ipHash, now))?.result;
export const setIpCache = (ipHash: string, result: string, expiresAt: number): void => {
    q.setIpCache.run(ipHash, result, expiresAt);
};

export const getMeta = (key: string): string | undefined => one<{ value: string }>(q.getMeta.get(key))?.value;
export const setMeta = (key: string, value: string): void => {
    q.setMeta.run(key, value);
};

export const logAction = (
    staffId: string, via: string, action: string, target: string | null, detail: string | null, now: number,
): void => {
    q.logAction.run(staffId, via, action, target, detail, now);
};

// --- retention (privacy) ---
export interface Retention {
    sessionMs: number;
    attemptMs: number;
    deviceAfterLeaveMs: number;
}

export function purgeExpired(now: number, retention: Retention): Record<string, number> {
    const run = (sql: string, ...params: number[]) => Number(db.prepare(sql).run(...params).changes);
    return inTransaction(() => ({
        sessions: run('DELETE FROM verification_sessions WHERE created_at < ?', now - retention.sessionMs),
        attempts: run('DELETE FROM verification_attempts WHERE created_at < ?', now - retention.attemptMs),
        ipCache: run('DELETE FROM ip_cache WHERE expires_at < ?', now),
        // A departed member's device links are deleted once the retention period passes.
        devices: run(
            `DELETE FROM device_identifiers WHERE discord_id IN (
                SELECT discord_id FROM verified_accounts WHERE left_at IS NOT NULL AND left_at < ?)`,
            now - retention.deviceAfterLeaveMs,
        ),
    }));
}

/** Erasure request (GDPR-style): deletes all verification data of one person. */
export function deleteUserData(discordId: string): Record<string, number> {
    const run = (sql: string) => Number(db.prepare(sql).run(discordId).changes);
    return inTransaction(() => ({
        sessions: run('DELETE FROM verification_sessions WHERE discord_id = ?'),
        attempts: run('DELETE FROM verification_attempts WHERE discord_id = ?'),
        devices: run('DELETE FROM device_identifiers WHERE discord_id = ?'),
        verified: run('DELETE FROM verified_accounts WHERE discord_id = ?'),
        actions: run('DELETE FROM admin_actions WHERE target = ?'),
    }));
}
