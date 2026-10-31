# Architecture

## Components

| Component | Responsibility | Holds |
|---|---|---|
| **Website** (`web/`) | Discord OAuth, shows the Turnstile widget, collects browser signals, shows the result | Nothing durable. Only short-lived cookies |
| **Bot API** (`bot/api/`) | Signed JSON endpoints under `/v1/*` | – |
| **Verification service** (`bot/verification/`) | Runs the checks, decides, grants roles, manages review | SQLite database |
| **Discord layer** (`bot/commands`, `bot/events`) | Panel, staff buttons/commands, join/leave handling, raid counter | – |

The website never decides anything and never sees the reason for a decision: a staff rejection and an automatic block look identical to the user, and scores/signals only reach the staff channel.

## Flow

1. `GET /api/auth/discord/login` → Discord OAuth (`identify`). A signed `state` cookie protects against CSRF.
2. Callback: the code is exchanged, `/users/@me` is read, and the token is **revoked immediately**. The site calls `POST /v1/session/create`.
3. Bot: bot accounts rejected → membership checked → rate limits → a single-use **session** (10 min) is returned. A new session invalidates older open ones.
4. The challenge page calls `POST /v1/session/view`: the **bot starts the dwell timer** and returns a `cdata` value bound to the session; the Turnstile widget is rendered with it.
5. `POST /v1/verify/submit` carries the Turnstile token, device token, fingerprint, locale and interaction/automation hints. The site adds the IP and Vercel's geo headers.
6. The bot runs the checks (below), decides, and **applies the decision at once**: grants roles, or posts a review message with buttons, or just logs.
7. The result page asks `POST /v1/result/get` with a 15-minute result token.

## Signals and decisions

A check returns signals of three kinds: `BLOCK` (blocks alone), `REVIEW` (forces manual review alone), `SCORE` (adds points). Order of evaluation in `bot/verification/engine.mts`: any BLOCK → score ≥ block threshold → any REVIEW or score ≥ review threshold → raid mode → approve.

| Code | Kind | Meaning |
|---|---|---|
| `TURNSTILE_FAILED` / `TURNSTILE_MISMATCH` | BLOCK | Failed captcha / wrong action, hostname or session |
| `TURNSTILE_UNAVAILABLE` | REVIEW | Cloudflare unreachable (not the user's fault, but no auto-approve) |
| `DEVICE_TOKEN_REUSED` | BLOCK | The signed device token already belongs to another verified account |
| `DEVICE_FP_MATCH` | REVIEW | Browser fingerprint seen on another verified account |
| `STORAGE_CLEARED` | SCORE 20 | Familiar fingerprint but no device token |
| `IP_SHARED` | REVIEW | Another account was approved from the same IP (IPv6: same /64) in the last 7 days |
| `PREVIOUSLY_REJECTED` | BLOCK | Rejected by staff and not reset since |
| `IP_PROXY` | REVIEW | VPN / proxy / Tor / datacenter |
| `IP_HIGH_RISK` | SCORE 20 | IP risk ≥ 66 |
| `IP_CHECK_FAILED` | by `IP_CHECK_FAIL_MODE` | Lookup failed |
| `ACCOUNT_TOO_NEW` | REVIEW | Younger than `MIN_ACCOUNT_AGE_DAYS` |
| `ACCOUNT_YOUNG` | SCORE 20 | Younger than 30 days |
| `ACCOUNT_SPAMMER_FLAG` | REVIEW | Discord's spammer flag |
| `NO_AVATAR` / `NO_GLOBAL_NAME` | SCORE 10 / 5 | Bare profile |
| `TZ_MISMATCH` / `TZ_MISSING` | SCORE 15 / 10 | Browser timezone differs from the IP's, or is unavailable |
| `LANG_MISMATCH` | SCORE 5 | Only with `LOCALE_HINT` |
| `FAST_SUBMIT` | SCORE 25 | Less than 4 s on the page (measured by the server) |
| `NO_INTERACTION` | SCORE 15 | No pointer/touch/key events |
| `HEADLESS` | SCORE 20–40 | Automation hints |

Weights live in `bot/verification/weights.mts`. Weak or forgeable signals (fingerprint, browser hints) never block alone.

## Bot API contract

Every `POST /v1/*` request is signed.

| Header | Value |
|---|---|
| `x-ts` | Current time in ms; must be within ±60 s of the bot's clock |
| `x-nonce` | 16–64 chars `[A-Za-z0-9_-]`, **new for every request** (reuse → 401) |
| `x-signature` | `HMAC-SHA256(API_SECRET, "<ts>.<nonce>.<METHOD>.<path>.<sha256hex(body)>")`, hex |

Responses: `200 {"ok":true,"data":…}` or `{"ok":false,"error":"unauthorized|bad_request|not_found|method_not_allowed|too_large|rate_limited|internal"}`. A 401 never says why; details go to the bot log. Bodies over 16 KB get 413; unknown JSON fields are rejected. `GET /health` is unsigned (503 until the bot is connected to Discord).

| Endpoint | Request | `data` |
|---|---|---|
| `/v1/session/create` | Discord `/users/@me` object as `user`, `ip`, `ipCountry`, `ipTimezone` | `{status: ok, sessionToken}` · `already_verified` (+`rolesOk`) · `not_member` · `bot` · `rate_limited` (+`retryAfterSec`) |
| `/v1/session/view` | `{sessionToken}` | `{ok:true, username, expiresInSec, cdata}` or `{ok:false}` |
| `/v1/verify/submit` | token, device token, fingerprint, locale, `interactions`, `headless`, network info | `{status:"invalid_session"}` or `{status:"done", deviceToken, resultToken}` |
| `/v1/result/get` | `{resultToken, ip}` | `{status: verified \| manual \| blocked \| role_failed \| invalid}` |

IP rate limits: `session/create` 60/h, `verify/submit` 30/10 min, `result/get` 120/min. Per Discord account: `RETRY_PER_HOUR` / `RETRY_PER_DAY` *submitted* attempts.

## Data stored (`bot/db.mts`)

`verification_sessions`, `verification_attempts` (signals, score, decision, staff outcome), `verified_accounts`, `device_identifiers`, `ip_cache`, `admin_actions`, `meta` (raid state). IPs, device ids and fingerprints are **HMAC hashes** keyed by `HASH_PEPPER`. A lock file prevents two bot processes from sharing one database.

## Security properties worth keeping

- OAuth token revoked right after use; never stored.
- Turnstile verified on the bot with `action`, `cdata` and `hostname` checks, so a token cannot be replayed on another session or site.
- Dwell time measured on the server, not reported by the client.
- Device token is signed by the server; the fingerprint is only a weak hint.
- Sessions are single-use (atomic consume); manual decisions are atomic too (two staff cannot both decide).
- Strict CSP with a per-request nonce, `X-Frame-Options: DENY`, same-origin checks on state-changing requests.
