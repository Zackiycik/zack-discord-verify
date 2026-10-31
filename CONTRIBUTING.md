# Contributing

Thanks for helping! Bug reports, docs fixes and new checks are all welcome.

```bash
npm run install:all
npm run typecheck && npm test
```

- **Node 24+.** The bot is TypeScript run directly by Node (`.mts`, no build step), so only *erasable* syntax is allowed (no `enum`, no parameter properties).
- Keep the website free of data and decisions; anything that decides belongs in `bot/verification/`.
- New risk signal: add the check under `bot/verification/checks/`, a weight in `weights.mts`, a label in `labels.mts`, and tests. Prefer `REVIEW` or `SCORE` over `BLOCK` for anything a user can legitimately trigger (VPNs, shared networks, new accounts).
- Never log or persist raw IPs, tokens or fingerprints.
- Keep user-facing text in `web/src/lib/copy.ts` and the staff texts in `bot/verification/staff.mts`.
- Add tests for behaviour changes; the site ↔ bot signature contract is tested from both sides.

Open an issue before starting a large change.
