import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Tests must never touch real data: under the node test runner a real database is never opened unless a path
// is given explicitly, and ':memory:' is supported.
const underTestRunner = Boolean(process.env['NODE_TEST_CONTEXT']);
const dbPath =
    process.env['DB_PATH'] ||
    (underTestRunner ? ':memory:' : path.join(import.meta.dirname, 'data', 'verify.db'));
const inMemory = dbPath === ':memory:';

if (!inMemory) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// WAL: a crash mid-write cannot corrupt the file, unfinished transactions are rolled back.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');
// Backup/maintenance scripts may write while the bot runs: wait instead of failing with a lock error.
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    -- All timestamps are in milliseconds.
    CREATE TABLE IF NOT EXISTS verification_sessions (
        id                  TEXT PRIMARY KEY,
        token_hash          TEXT NOT NULL UNIQUE,
        discord_id          TEXT NOT NULL,
        username            TEXT NOT NULL DEFAULT '',
        avatar              TEXT,
        global_name         TEXT,
        public_flags        INTEGER NOT NULL DEFAULT 0,
        ip_hash             TEXT,
        ip_country          TEXT,
        ip_timezone         TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        created_at          INTEGER NOT NULL,
        challenge_viewed_at INTEGER,
        expires_at          INTEGER NOT NULL,
        consumed_at         INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_vs_discord ON verification_sessions (discord_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_vs_ip ON verification_sessions (ip_hash, created_at);

    CREATE TABLE IF NOT EXISTS verification_attempts (
        id                TEXT PRIMARY KEY,
        session_id        TEXT,
        discord_id        TEXT NOT NULL,
        username          TEXT NOT NULL DEFAULT '',
        ip_hash           TEXT,
        ip_country        TEXT,
        device_id_hash    TEXT,
        fingerprint_hash  TEXT,
        client_tz         TEXT,
        client_lang       TEXT,
        signals           TEXT NOT NULL,
        risk_score        INTEGER NOT NULL,
        decision          TEXT NOT NULL,
        reason_codes      TEXT NOT NULL,
        role_status       TEXT NOT NULL DEFAULT 'n/a',
        role_error        TEXT,
        review_outcome    TEXT,
        reviewed_by       TEXT,
        reviewed_via      TEXT,
        reviewed_at       INTEGER,
        review_note       TEXT,
        log_message_id    TEXT,
        result_token_hash TEXT UNIQUE,
        created_at        INTEGER NOT NULL,
        result_expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_va_discord ON verification_attempts (discord_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_va_ip ON verification_attempts (ip_hash, created_at);
    CREATE INDEX IF NOT EXISTS idx_va_fp ON verification_attempts (fingerprint_hash);
    CREATE INDEX IF NOT EXISTS idx_va_created ON verification_attempts (created_at);

    CREATE TABLE IF NOT EXISTS verified_accounts (
        discord_id  TEXT PRIMARY KEY,
        method      TEXT NOT NULL,
        attempt_id  TEXT,
        verified_at INTEGER NOT NULL,
        left_at     INTEGER,
        revoked_at  INTEGER,
        revoked_by  TEXT
    );

    CREATE TABLE IF NOT EXISTS device_identifiers (
        type       TEXT NOT NULL,
        hash       TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen  INTEGER NOT NULL,
        PRIMARY KEY (type, hash, discord_id)
    );
    CREATE INDEX IF NOT EXISTS idx_device_hash ON device_identifiers (type, hash);

    CREATE TABLE IF NOT EXISTS ip_cache (
        ip_hash    TEXT PRIMARY KEY,
        result     TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_actions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id   TEXT NOT NULL,
        via        TEXT NOT NULL,
        action     TEXT NOT NULL,
        target     TEXT,
        detail     TEXT,
        created_at INTEGER NOT NULL
    );
`);

export function inTransaction<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

// Two bot processes writing to the same database would overwrite each other: the second must not start.
let lockFile: string | null = null;

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

export function acquireInstanceLock(): void {
    if (inMemory) return;
    lockFile = `${dbPath}.lock`;

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

            const pid = Number(fs.readFileSync(lockFile, 'utf8'));
            if (pid && pid !== process.pid && isProcessAlive(pid)) {
                throw new Error(`The bot is already running (PID ${pid}). A second copy was not started.`);
            }
            // Leftover from a crashed process.
            fs.rmSync(lockFile, { force: true });
        }
    }
    throw new Error('Could not acquire the bot lock.');
}

export function close(): void {
    try {
        db.close();
    } catch {
        // already closed
    }
    if (lockFile) {
        fs.rmSync(lockFile, { force: true });
        lockFile = null;
    }
}
