# Security policy

Please report vulnerabilities privately (GitHub → *Security* → *Report a vulnerability*), not in public issues. Include steps to reproduce and the affected version. You will get an acknowledgement within a few days.

Particularly interesting: signature/replay bypasses on the bot API, ways to obtain the role without passing the checks, Turnstile token reuse, information leaks from the website, and SQL/command injection.

If you run this software, remember: keep `API_SECRET`, `HASH_PEPPER`, `DEVICE_SECRET`, `TURNSTILE_SECRET` and the bot token secret; keep the log/review channels staff-only; keep the bot's role as low as it can be while still above the verification roles.
