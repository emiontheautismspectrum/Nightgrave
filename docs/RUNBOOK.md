# Nightgrave runbook

Short, copy-paste operations for the live game (https://nightgrave.com, API
`https://nightgrave-api.emiontheautismspectrum.workers.dev`). Setup from scratch is in [DEPLOY.md](DEPLOY.md).
Commands are given for PowerShell (Windows) and bash. Run Wrangler commands inside `server/`.

Your real `database_id` is a LOCAL, uncommitted edit of `server/wrangler.toml`. Update with
`git pull --autostash` (a plain `git pull` refuses when the merge touches that file) and check it before deploying:

```bash
git checkout main && git pull --autostash && grep -E "database_id|ALLOWED_ORIGINS" server/wrangler.toml
```

## Secrets in your shell (never typed into the history)

PowerShell (the prompt's input is not saved in the history; works in Windows PowerShell 5 and PowerShell 7):

```powershell
$env:NG_ADMIN = [System.Net.NetworkCredential]::new('', (Read-Host "Admin token" -AsSecureString)).Password
```

bash:

```bash
read -rs -p "Admin token: " NG_ADMIN && export NG_ADMIN && echo
```

The same for `NG_VERIFIER` (the verifier token). Close the terminal afterwards.

## Pause or resume submissions (kill switch)

`SUBMISSIONS_ENABLED` lives in `server/wrangler.toml` `[vars]`. A dashboard edit is overwritten by the next
`wrangler deploy`, so the supported way is: edit the line to `SUBMISSIONS_ENABLED = "false"`, deploy, and later
set it back to `"true"` and deploy again. The board keeps working; new submissions get "Submissions are paused".

```bash
cd server && npx wrangler deploy
```

## Roll back

- Worker: `npx wrangler rollback` (in `server/`; it offers the previous version), or deploy an older commit.
- Pages: dashboard -> **Workers & Pages** -> **nightgrave** -> **Deployments** -> the previous deployment -> **Rollback**.
- Rolling back the Worker never needs a database rollback: migrations are additive.

## Moderation: delete an entry or clear a message

Find the entry id (read-only query):

```bash
npx wrangler d1 execute nightgrave --remote --command "SELECT id, date, name, message, score, verified FROM entries WHERE date = '2026-11-07' ORDER BY score DESC LIMIT 20"
```

Clear a message (PowerShell, then bash), replace `123`:

```powershell
curl.exe -s -X POST -H "Authorization: Bearer $env:NG_ADMIN" https://nightgrave-api.emiontheautismspectrum.workers.dev/api/admin/clear-message/123
```

```bash
curl -s -X POST -H "Authorization: Bearer $NG_ADMIN" https://nightgrave-api.emiontheautismspectrum.workers.dev/api/admin/clear-message/123
```

Delete an entry (also answers a deletion request):

```powershell
curl.exe -s -X DELETE -H "Authorization: Bearer $env:NG_ADMIN" https://nightgrave-api.emiontheautismspectrum.workers.dev/api/admin/entry/123
```

```bash
curl -s -X DELETE -H "Authorization: Bearer $NG_ADMIN" https://nightgrave-api.emiontheautismspectrum.workers.dev/api/admin/entry/123
```

`{"ok":true}` = done (the board cache is purged). `{"error":"not_found"}` = wrong id or wrong token (deliberately the
same answer). Every action is written to the audit log (action, entry id, result; no personal data).

## Rotate a secret

Generate a new value and store it (asks for the value; nothing lands in the history):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
cd server && npx wrangler secret put ADMIN_TOKEN
```

- `ADMIN_TOKEN`: only your moderation commands change.
- `VERIFIER_TOKEN`: ALSO update the GitHub secret (repository **Settings** -> **Secrets and variables** -> **Actions**
  -> `VERIFIER_TOKEN`), otherwise verification stops and `/api/health` turns `"ok":false` after 90 minutes.
- `IP_SALT`: the rate-limit counters start from zero (they are keyed by the salted IP hash); nothing else changes.

A secret put takes effect immediately (no deploy needed).

## Backups and restore

The main backup is D1 **Time Travel**: point-in-time restore of any minute in the last **7 days on the Free plan**
(30 on Workers Paid; Cloudflare D1 limits page, checked 2026-11-07). Restoring REPLACES the current database.

```bash
npx wrangler d1 time-travel info nightgrave
```

```bash
npx wrangler d1 time-travel restore nightgrave --timestamp=2026-11-07T10:00:00Z
```

Manual export (for example before a risky change), kept OUTSIDE the repository (a private folder or a password-manager
attachment; `*.sql` backups are git-ignored except `server/migrations/`):

```bash
npx wrangler d1 export nightgrave --remote --output ../../nightgrave-backup-2026-11-07.sql
```

There is deliberately no scheduled export workflow: the repository is public, so workflow artifacts can be downloaded
by any logged-in GitHub user, and it would need a Cloudflare API token stored in GitHub. The data is low value (a
30-day daily board, rebuilt every day); Time Travel plus an occasional manual export is enough.

## Apply database migrations (BEFORE deploying the Worker)

When a pull request adds a file to `server/migrations/`:

```bash
cd server && npx wrangler d1 migrations apply nightgrave --remote
```

```bash
npx wrangler deploy
```

Order: merge -> wait for the Pages build -> pull (`--autostash`) -> migrations -> Worker deploy -> health check.

## Logs, analytics, monitoring

- Live Worker logs: `npx wrangler tail` (in `server/`; live only, nothing stored). Workers Logs (`[observability]` in
  wrangler.toml) keeps errors and the Worker's own console output in the dashboard: **Workers & Pages** ->
  **nightgrave-api** -> **Logs**. Invocation logs are deliberately OFF (`invocation_logs = false`): they would store
  request metadata such as client IPs, which the privacy page says are never stored. Keep it that way, or update
  privacy.html in the same change.
- Analytics: the same Worker page (requests, errors, CPU); D1 -> **nightgrave** -> **Metrics** (rows read / written
  against the daily free limits).
- GitHub emails you when a workflow run fails (Settings -> Notifications -> Actions).
- After merging a Dependabot bump of vitest or vite, run **Actions** -> **verify-replays** -> **Run workflow** by hand
  and check it is green (a red run also arrives as an email from GitHub); `tests/script_bins.test.ts` guards the binaries.
- Uptime: a free monitor (for example UptimeRobot or Better Stack) on
  `https://nightgrave-api.emiontheautismspectrum.workers.dev/api/health` every 5-10 minutes, alerting when the body
  does not contain `"ok":true` (a keyword check) or the status is not 200. `"ok":false` with 200 = the verifier has not
  processed a pending run for 90 minutes; 503 = D1 is failing.

```bash
curl -s https://nightgrave-api.emiontheautismspectrum.workers.dev/api/health
```

## The verifier

- Run now: GitHub -> **Actions** -> **verify-replays** -> **Run workflow**.
- Locally (PowerShell, then bash), with the verifier token read as above:

```powershell
$env:API_BASE = "https://nightgrave-api.emiontheautismspectrum.workers.dev"; $env:VERIFIER_TOKEN = $env:NG_VERIFIER; npm run verify:pending
```

```bash
API_BASE=https://nightgrave-api.emiontheautismspectrum.workers.dev VERIFIER_TOKEN="$NG_VERIFIER" npm run verify:pending
```

- GitHub DISABLES scheduled workflows after 60 days without repository activity. `/api/health` shows it
  (`oldestPendingMinutes` grows, `"ok":false`). Re-enable: **Actions** -> **verify-replays** -> **Enable workflow**.
- Actions minutes: unlimited for public repositories. If the repository ever becomes private (2,000 free minutes per
  month), change the schedule in `.github/workflows/verify.yml` to `*/30 * * * *` or hourly (`0 * * * *`).

## Abuse and quotas

- `ALLOWED_ORIGINS` is NOT authentication: browsers send an Origin, scripts do not. It only stops other websites from
  using the API from a visitor's browser. The real protections are the replay verification (only re-simulated runs
  reach the board), the rate limits, the pending cap and the input checks. `http://localhost:5173` stays in the list
  for local development against the real API (`npm run dev`); it grants nothing a script could not already do.
- Pages preview deployments (`<hash>.nightgrave.pages.dev`) are public by default and are NOT in `ALLOWED_ORIGINS`: a
  preview shows the board as offline, by design. To hide previews: Pages -> **nightgrave** -> **Settings** -> **Builds**
  -> preview deployments: none (or production branch only), or protect `*.nightgrave.pages.dev` with Cloudflare
  Access (Zero Trust, free for small teams).
- Floods: the free plan has 100,000 Worker requests and 100,000 D1 row writes per day (DEPLOY.md, "Free-plan limits").
  The Worker keeps its own D1 writes bounded, but any request counts against the request quota. When the API runs out,
  the game shows the board as unavailable and keeps working. If floods become a problem, put the API on a custom
  domain of the zone (Worker -> **Settings** -> **Domains & Routes** -> `api.nightgrave.com`, then `VITE_API_BASE`, the
  GitHub `API_BASE` secret and `ALLOWED_ORIGINS` stay consistent) and add a Cloudflare **rate limiting rule** (Security
  -> WAF -> Rate limiting rules; one rule is included in the free plan), for example: URI path starts with
  `/api/verify/` or `/api/admin/`, 20 requests per 10 seconds per IP -> Block. Rules do not apply to the workers.dev
  address.

## GitHub and account settings (check once, then yearly)

GitHub repository **Settings**:

- **Code security**: Secret scanning ON, Push protection ON, Dependabot alerts ON, Dependabot security updates ON.
- **Private vulnerability reporting** ON (SECURITY.md relies on it). Check: the repository's **Security** tab shows a
  **Report a vulnerability** button (look while logged out or in a private window).
- **Rules** -> **Rulesets** (or Branches -> branch protection) for `main`: require a pull request, require status
  checks to pass, block force pushes, block deletion.
- **Secrets and variables** -> **Actions**: exactly `API_BASE` and `VERIFIER_TOKEN`. Repository secrets are readable
  only by workflows of this repository (never by pull requests from forks) and by nobody through the UI.

Cloudflare:

- Pages -> **nightgrave** -> **Settings** -> **Variables and Secrets**: only `VITE_API_BASE` (the workers.dev
  address). `VITE_SITE_URL` unset (a leftover overrides the canonical address).
- **My Profile** -> **API Tokens**: delete tokens you do not use; Wrangler's login token can be revoked and renewed with
  `npx wrangler logout` / `npx wrangler login`.

Accounts: two-factor authentication on GitHub AND Cloudflare (a passkey or an authenticator app, not SMS).

Local files: never keep a token in a file inside the repository (for example a text file in `server/`). Run
`git status` before every commit, read the untracked files, and never `git add .` without reading what it adds.
`.dev.vars`, `.env*` and `*.sql` backups are git-ignored.

## Postmortem template

```text
Date / duration:
What players saw:
Cause:
What fixed it:
What prevents it next time:
```
