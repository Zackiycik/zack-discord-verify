# Setup guide

Plan about 30 minutes. You will create a Discord application, three roles/channels, a Turnstile widget, deploy the website and connect it to the bot.

## 1. Discord application

1. [Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → *Reset Token* (this is `TOKEN`) → enable **Server Members Intent**.
3. **General Information** → copy the *Application ID* (`CLIENT_ID`).
4. **OAuth2** tab → copy the *Client ID* / *Client Secret* (the website needs both) and add the redirect  
   `https://<your-site>/api/auth/discord/callback` (and `http://localhost:3000/api/auth/discord/callback` for local tests).
5. Invite the bot: **OAuth2 → URL Generator**, scopes `bot` + `applications.commands`, permissions **Manage Roles**, **View Channels**, **Send Messages**, **Embed Links**.

Enable Developer Mode in Discord (Settings → Advanced) so you can *Copy ID* of servers, roles and channels.

## 2. Roles and channels

Create:

| Thing | Purpose |
|---|---|
| `Verified` role | What members get after verifying (`VERIFIED_ROLE_ID`) |
| `Unverified` role | Given on join, removed on verification (`UNVERIFIED_ROLE_ID`) |
| `#verify` channel | Visible to *Unverified*; this is where `/verify-panel` goes |
| `#verification-log` channel | **Staff only.** Every attempt is logged here (`VERIFY_LOG_CHANNEL_ID`) |
| `#verification-review` (optional) | Staff only. Review buttons go here instead of the log (`VERIFY_REVIEW_CHANNEL_ID`) |

Permissions pattern: *Unverified* sees only `#verify`; the rest of the server requires *Verified*.  
**Role hierarchy:** drag the bot's role **above** both `Verified` and `Unverified`. The bot checks this at startup and warns you.

## 3. Cloudflare Turnstile

[dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile → add a widget, mode **Managed**, hostnames: your site's domain (plus `localhost` while testing).  
The **site key** goes to the website (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`), the **secret key** goes to the bot only (`TURNSTILE_SECRET`). Put the domain in the bot's `TURNSTILE_HOSTNAMES`.

## 4. Configure the bot

```bash
cp bot/.env.example bot/.env
```

Fill in every non-optional value. Generate the three secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`API_SECRET` must be identical on the website. `HASH_PEPPER` and `DEVICE_SECRET` stay on the bot; **changing them later invalidates existing device links**.

Optional but recommended: a free [proxycheck.io](https://proxycheck.io) key (`PROXYCHECK_KEY`) for VPN/proxy detection.

```bash
npm run bot:deploy     # registers slash commands for your server
npm run bot:start
```

You should see `🔒 Configuration audit clean.` and `🌐 Verification API listening…`. Warnings tell you exactly what to fix (missing permission, role hierarchy, unknown IDs).

Keep it running as a service so it restarts after a crash or reboot. With pm2:

```bash
npm i -g pm2
cd bot && pm2 start "node index.mts" --name zack-verify && pm2 save && pm2 startup
```

or with systemd (`/etc/systemd/system/zack-verify.service`):

```ini
[Unit]
Description=Zack Verify bot
After=network-online.target

[Service]
WorkingDirectory=/opt/zack-verify/bot
ExecStart=/usr/bin/node index.mts
Restart=always
User=zackverify

[Install]
WantedBy=multi-user.target
```

## 5. Make the bot API reachable

The website calls the bot over HTTPS. The API listens on `127.0.0.1:8787`; expose it with one of:

- **Cloudflare Tunnel**: `cloudflared tunnel --url http://127.0.0.1:8787`
- **Tailscale Funnel**: `tailscale funnel --bg 8787`
- a reverse proxy (Caddy/nginx) with TLS in front of `127.0.0.1:8787`

Check from outside: `curl https://<bot-address>/health` → `{"ok":true}`.  
Every other endpoint requires a valid signature, so exposing it is safe as long as `API_SECRET` stays secret.

## 6. Deploy the website (Vercel)

1. Push this repository to GitHub, import it in Vercel, set **Root Directory** to `web`.
2. Add the variables from `web/.env.example` (`APP_URL`, `DISCORD_*`, `BOT_API_URL`, `API_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `SESSION_SECRET`, …).
3. Deploy, then set `VERIFY_WEB_URL` in the bot's `.env` to the site's address and restart the bot.

> The site trusts Vercel's `x-real-ip` / `x-vercel-ip-*` headers. On another host, put it behind a proxy that sets trustworthy values of those headers, otherwise IP checks can be spoofed.

## 7. Go live

1. In `#verify`, run `/verify-panel`.
2. Verify with a test account (a second Discord account that joined the server). Try the staff flow with a young account or a VPN: the attempt should arrive in the review channel.
3. Check `/verification info <user>` and `/raid status`.

### Local testing without Cloudflare

Set `TURNSTILE_TEST_KEYS=1` in the bot's `.env` and use Cloudflare's test site key `1x00000000000000000000AA` on the website. The bot refuses to start with it if `NODE_ENV=production`.

## Operating notes

- **Backups:** the whole state is one SQLite file (`bot/data/verify.db`, or `DB_PATH`). Stop the bot or use `sqlite3 .backup` to copy it.
- **Importing existing members:** members already in the server are not verified automatically. Either give them the `Verified` role directly, or run `/verification approve` for them.
- **Someone was wrongly blocked:** `/verification reset <user>` clears the block; they can verify again. Use `approve` to skip the checks altogether.
- **Data requests:** `/verification delete <user> confirm:True`.
- **Retention:** attempts 90 days, sessions 1 day, device links 12 months after the member leaves (edit `DEFAULT_SERVICE_CONFIG` in `bot/verification/service.mts`).
