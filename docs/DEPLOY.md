# Deploying Nightgrave (Cloudflare, free plan)

Day-to-day operations (kill switch, rollback, moderation, secret rotation, backups, monitoring) are in
[RUNBOOK.md](RUNBOOK.md).

The game is a static site (Cloudflare Pages). The Hard "Today's best" board is one Cloudflare Worker with one D1
database (folder `server/`). Without the Worker the game still works fully offline: the title shows
"Online board: offline".

You need: a GitHub account with this repository, Node.js 20+ and a terminal. Every command is copy-paste.
Commands starting with `npx wrangler` are run inside the `server/` folder.

## 1. Create a Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and create a free account (verify your email).

## 2. Log in from the terminal

```bash
cd server
npm install
npx wrangler login
```

A browser window opens: click **Allow**.

## 3. Create the database

```bash
npx wrangler d1 create nightgrave
```

The output contains a line like `database_id = "1234abcd-..."`. Open `server/wrangler.toml` and replace
`REPLACE_WITH_YOUR_D1_DATABASE_ID` with that id.

## 4. Create the tables (remote)

```bash
npx wrangler d1 migrations apply nightgrave --remote
```

Answer `y` when asked. This applies every file in `server/migrations/` (including `0002_verification.sql` and
`0004_view.sql`, which adds the `view` column: existing rows become `full`); after pulling a new version, run it again
before `npx wrangler deploy`.

## 5. Create three secrets

Generate a random value (works on Windows, macOS and Linux):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice (each value must be at least 32 characters; this command prints 64) and keep both values somewhere private (a password manager). Then store them in Cloudflare:

```bash
npx wrangler secret put ADMIN_TOKEN
```

```bash
npx wrangler secret put IP_SALT
```

```bash
npx wrangler secret put VERIFIER_TOKEN
```

Run the generator three times. Each command asks you to paste a value. `ADMIN_TOKEN` is your moderation password;
`IP_SALT` makes the stored IP hashes useless to anyone else; `VERIFIER_TOKEN` lets the replay verifier (step 14) post
its verdicts. The Worker refuses to run without all of them (at least 32 characters each, 16 for the salt).
Secrets are never stored in git.

## 6. Set the allowed origins

Open `server/wrangler.toml` and set `ALLOWED_ORIGINS` to the addresses your game is served from (step 8 and, with a
custom domain, step 12): exact origins, comma-separated, no wildcard, no trailing slash. This game uses:

```toml
ALLOWED_ORIGINS = "https://nightgrave.com,https://nightgrave.pages.dev,http://localhost:5173"
```

(Keep `,http://localhost:5173` at the end only if you also test locally against the real API.)

## 7. Deploy the Worker

```bash
npx wrangler deploy
```

The output ends with the Worker address, e.g. `https://nightgrave-api.<your-subdomain>.workers.dev`. Keep it.

## 8. Create the Pages project (the game)

1. In the Cloudflare dashboard: **Workers & Pages** -> **Create** -> **Pages** -> **Connect to Git**.
2. Pick this repository and the branch you want to publish (usually `main`).
3. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
4. **Environment variables** (Production): add `VITE_API_BASE` = the Worker address from step 7
   (for example `https://nightgrave-api.<your-subdomain>.workers.dev`, no trailing slash).
5. Click **Save and Deploy**. The game is then at `https://<project>.pages.dev`.
6. If that address differs from what you set in step 6, update `ALLOWED_ORIGINS` and run `npx wrangler deploy` again.

The build writes `dist/_headers` (strict Content-Security-Policy that allows exactly your API origin, long cache for
hashed assets). Rebuild Pages whenever you change `VITE_API_BASE`.

## 9. Verify with curl

```bash
curl -s https://nightgrave-api.<your-subdomain>.workers.dev/api/daily
```

Expected: `{"date":"YYYY-MM-DD","serverNow":"...","top":[],"champion":null}` (JSON, never HTML).

```bash
curl -s -i -X OPTIONS https://nightgrave-api.<your-subdomain>.workers.dev/api/submit -H "Origin: https://<project>.pages.dev" -H "Access-Control-Request-Method: POST"
```

Expected: `204` with `Access-Control-Allow-Origin: https://<project>.pages.dev`.

Then open the game, choose **Difficulty: Daily** (Hard), play, and submit a name: it shows up under
**TODAY'S BEST** and as today's champion on the title.

## 10. Moderation

Find an entry id (D1 console in the dashboard, or):

```bash
npx wrangler d1 execute nightgrave --remote --command "SELECT id, date, name, message, score FROM entries ORDER BY id DESC LIMIT 20"
```

Delete an entry:

```bash
curl -s -X DELETE https://nightgrave-api.<your-subdomain>.workers.dev/api/admin/entry/123 -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Clear only the champion message of an entry:

```bash
curl -s -X POST https://nightgrave-api.<your-subdomain>.workers.dev/api/admin/clear-message/123 -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

Pause all new submissions (kill switch; the board keeps working): set `SUBMISSIONS_ENABLED = "false"` in
`server/wrangler.toml` and run `npx wrangler deploy`; set it back to `"true"` and deploy again to resume.

A wrong or missing token answers `404` (the admin routes do not reveal themselves). The blocked-word list is
`src/shared/profanity.json`: extend it, then rebuild Pages and redeploy the Worker (both use it).

## 11. Site constants (fill in before going public)

All in `src/config.ts`, next to `TITLE`. Edit, commit, and Pages rebuilds:

| Constant | Example | Empty means |
| --- | --- | --- |
| `SITE_URL` | `https://nightgrave.com` (set; no trailing slash) | `og:url`, `og:image`, `twitter:image` and the canonical link are left out (link previews show no picture) |
| `SITE_DOMAIN` | `nightgrave.com` (set) | the footer says "(c) 2026 The Nightgrave Authors" |
| `CONTACT_EMAIL` | a project mailbox, never a personal one | the footer has no Contact link; the privacy page points to the source repository instead |
| `SOURCE_URL` | the GitHub repository | (set) |

`SITE_URL` can also be given at build time without a commit: add `VITE_SITE_URL` to the Pages environment variables
(it wins over the constant). `public/og-image.png` is regenerated by `python3 tools/gen_assets.py`.

The privacy, rules, credits and license pages are built from `privacy.html`, `rules.html`, `credits.html` and
`license.html`; `dist/_headers` applies the same CSP to them (`/*`).

## 12. Custom domain (nightgrave.com)

The canonical address of the game is `https://nightgrave.com` (`SITE_URL` / `SITE_DOMAIN` in `src/config.ts`); the
Worker already allows it (`ALLOWED_ORIGINS` in `server/wrangler.toml`). `https://nightgrave.pages.dev` keeps working.
Order, after the pull request that set this up:

1. Merge the pull request and wait for the Pages build of `main` to succeed. From then on every page names
   `https://nightgrave.com` as its canonical / og address, so do steps 2 and 3 right away (the domain was bought at
   Cloudflare Registrar, so its zone is already on Cloudflare: no nameserver change, the domain attaches in minutes).
2. Redeploy the Worker (REQUIRED: without it the board is blocked by CORS on the new domain). Your real
   `database_id` is a local, uncommitted edit of `server/wrangler.toml`, and the merge changed another line of that
   file: a plain `git pull` refuses to touch it. `--autostash` keeps your edit:

   ```bash
   git checkout main && git pull --autostash
   ```

   Check that your database id is still there (not `REPLACE_WITH_YOUR_D1_DATABASE_ID`) and that the new origin is in:

   ```bash
   grep -E "database_id|ALLOWED_ORIGINS" server/wrangler.toml
   ```

   ```bash
   cd server && npx wrangler deploy
   ```

3. Cloudflare dashboard: **Workers & Pages** -> **nightgrave** -> **Custom domains** -> **Set up a custom domain** ->
   `nightgrave.com`. The DNS record and the certificate are created automatically.
4. Optional: add `www.nightgrave.com` as a second custom domain, then a **Redirect Rule** `www` -> apex (301). The
   Worker does not allow `https://www.nightgrave.com` on purpose: a page served on `www` would get no board.
5. Verify (expected: `204` with `Access-Control-Allow-Origin: https://nightgrave.com`; a foreign origin gets `403`):

   ```bash
   curl -s -i -X OPTIONS https://nightgrave-api.<your-subdomain>.workers.dev/api/submit -H "Origin: https://nightgrave.com" -H "Access-Control-Request-Method: POST"
   ```

   ```bash
   curl -s -i -X OPTIONS https://nightgrave-api.<your-subdomain>.workers.dev/api/submit -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"
   ```

   Then open `https://nightgrave.com`, play Hard and submit a score.
6. Browser storage (best scores, settings, the board name) and an installed home-screen app are PER ORIGIN: players
   of `nightgrave.pages.dev` start fresh on the new domain, and the home-screen icon must be added again from it.
7. `nightgrave.pages.dev` keeps working. Sending its visitors to the new domain (a Pages redirect or a Redirect Rule)
   is a later, separate step.
8. Pages -> **nightgrave** -> **Settings** -> **Variables and Secrets**: `VITE_SITE_URL` must be unset or exactly
   `https://nightgrave.com` (a leftover value overrides `src/config.ts` at build time and silently puts a wrong
   canonical / og address on every page). `VITE_API_BASE` stays the workers.dev address.
9. Rollback: Pages -> **Deployments** -> the previous deployment -> **Rollback**; Worker: `npx wrangler rollback` (or
   deploy the previous commit). Removing the custom domain does not affect `nightgrave.pages.dev`.
10. The GitHub Actions secret `API_BASE` and the Pages variable `VITE_API_BASE` stay the workers.dev address:
    unchanged.

Later, an API domain is possible too (Worker -> **Settings** -> **Domains & Routes** -> `api.example.com`, then
`VITE_API_BASE` and the `API_BASE` secret point at it and Pages is redeployed).

## 13. Local development

```bash
cd server && cp .dev.vars.example .dev.vars && npx wrangler d1 migrations apply nightgrave --local && npx wrangler dev --port 8787
```

In a second terminal at the repository root:

```bash
VITE_API_BASE=http://localhost:8787 npm run dev
```

`npm run e2e:board` (with `wrangler dev` running) plays a Hard run in a browser under the production CSP, submits it
and checks it on the local board.

## 14. Replay verification (GitHub Actions)

Only VERIFIED runs appear on the board. A submitted run is first **pending**: the game says "Submitted. On the board
after verification". A scheduled GitHub Action (`.github/workflows/verify.yml`) re-simulates every pending run with
the game's own deterministic simulation and compares the result exactly (length, death on the last tick, score).
Verified runs go on the board, forged or broken ones are rejected (the reason is stored for moderation).

1. On github.com open the repository -> **Settings** -> **Secrets and variables** -> **Actions** ->
   **New repository secret**, and add:
   - `API_BASE` = your Worker address (e.g. `https://nightgrave-api.<your-subdomain>.workers.dev`, no trailing slash)
   - `VERIFIER_TOKEN` = the same value you stored with `npx wrangler secret put VERIFIER_TOKEN`
2. **Actions** tab -> **verify-replays** -> **Run workflow**. The log ends with `verify: nothing pending` or
   `verify: N verified, M rejected, 0 errors`. Tokens and player text are never printed.
3. Verify a single exported submission locally (moderation/debugging), a JSON with the fields of a pending item:

```bash
npm run verify:replay -- submission.json
```

**Minutes budget.** Public repositories have unlimited Actions minutes. A private repository has 2,000 free minutes per
month, and every run is billed as at least 1 minute (a run takes ~30-40 s: checkout, cached `npm ci`, early exit
when nothing is pending). Every 20 minutes = 72 runs/day = ~2,160 billed minutes/month: slightly OVER the free 2,000
for a private repo. For a private repo change the schedule in `.github/workflows/verify.yml` to every 30 minutes
(`*/30 * * * *`, ~1,440 minutes/month) or every hour (`0 * * * *`, ~720). Players then wait up to 30-60 minutes.

**Updating the game.** The verifier rejects runs recorded with a different tuning or client version (`outdated`).
Deploy new versions (Worker, Pages and the repository the Action runs from) right after 00:00 UTC, when the day's
board is new, so as few pending runs as possible are caught between versions.

## Free-plan limits to keep in mind

Checked on 2026-11-07 against the Cloudflare docs: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and the
[D1 free-tier enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).
Limits change: re-check those pages before relying on the numbers.

- Workers Free: 100,000 requests per day (reset 00:00 UTC; above it Cloudflare answers with error 1027), 10 ms CPU per
  request, 50 subrequests per request (this Worker makes none).
- D1 Free: 5 million rows read and 100,000 rows written per day (reset 00:00 UTC; since 2026-09-01 queries FAIL above
  either limit until the reset, stored data is untouched), 500 MB per database, Time Travel 7 days.
- Pages: 500 builds per month. Cron triggers: included.

What one attacker can consume with the current limits (`LIMITS` in `server/src/index.ts`):

| Route | D1 cost per request | Bound |
| --- | --- | --- |
| `GET /api/daily`, `GET /api/health` | NO writes. Reads only when the isolate's 30 s copy is stale (the Cache API stores nothing on workers.dev) | about 2 D1 queries per minute per isolate, whatever the traffic |
| `POST /api/daily/me` | NO writes; 1-3 indexed reads | 10 per minute per IP per isolate (memory limit) |
| `POST /api/submit` | 2 counter writes + a few reads + 1 write when accepted | 10 per hour per IP (global D1 limit); past it, 429 from memory without a write |
| wrong verifier / admin token | ONE aggregate audit row per hour and kind | at most 100 writes per hour per kind, then no D1 work |

Public read limits live in the isolate's memory (approximate: requests spread over several isolates get more), which
is fine for reads and keeps every read free of D1 writes; only submissions and authenticated admin calls use the
global D1 counters. One attacker IP can therefore spend at most a few hundred D1 writes per day (submissions).

The Worker REQUEST quota (100,000 per day) cannot be protected in code: every request counts, even a 404. Anyone can
spend it with a loop; the D1 write quota is protected by design. When either quota is exhausted, the API fails until 00:00
UTC and the game degrades gracefully: the board shows "board unavailable" / offline, runs and local best scores keep
working (covered by `tests/api_client.test.ts`: a non-JSON answer such as Cloudflare's error page, a timeout or a
network failure all end as "no board"). A stronger shield needs either Workers Paid or the API on a custom domain of
the zone (for example `api.nightgrave.com`), where a Cloudflare rate-limiting rule can drop floods before they reach
the Worker (see docs/RUNBOOK.md).

## Upgrading the game

**Database migrations first.** When a pull request adds a file to `server/migrations/`, apply it to the remote D1
BEFORE deploying the Worker (migrations are additive, the running Worker ignores new tables and columns):

```bash
cd server && npx wrangler d1 migrations apply nightgrave --remote && npx wrangler deploy
```

Migration `0005_audit.sql` (the audit log) is also safe the other way round: the Worker skips audit writes and the
failed-token counter while the table is missing, so a deploy before the migration never breaks the board.

Every client sends `clientVersion` and the tuning fingerprint. When tuning or `CLIENT_VERSION`
(`src/shared/version.ts`) changes, deploy the Worker and Pages together: old clients get "Game updated: reload the
page" instead of posting incompatible runs.

Order for such an update (for example the multiplier fix, version 0.8.0, which changes the tuning fingerprint):

1. Pause the replay verifier: GitHub -> Actions -> the "verify-replays" workflow -> "..." -> Disable workflow. (The
   Action runs the code of the default branch: after the merge it would SKIP old pending runs as "other version",
   leaving them pending until the 2-day expiry, ahead of newer runs in the queue; before it, the old code would
   skip new runs the same way.)
2. With the OLD code (before merging), clear the queue: `npm run verify:pending` with `API_BASE` and `VERIFIER_TOKEN`
   set (as in step 14), until it reports nothing pending.
3. Merge, then deploy the Worker and Pages together (`npx wrangler deploy` in `server/`, and let Pages build `main`),
   so the Worker never accepts runs its verifier cannot replay.
4. Enable the workflow again. Players with an old page open get "Game updated: reload the page" when they submit; a
   reload fixes it.

The heroes pass (version 0.9.0) is such an update, and more: the hero is now part of the replay CORE (binary log
format 2). An old Worker refuses a 0.9.0 submission as `outdated` without writing anything (checked by
`npm run e2e:old-worker`, which runs the Worker code of `origin/main` locally against an in-memory database), and the
new Worker / verifier refuse old-format logs. So the steps above are mandatory, in that order: pause the verifier,
drain the queue with the OLD code, merge, deploy the Worker and Pages together (no new D1 migration), enable the
verifier. Today's board keeps its already verified entries; both heroes share one daily board.

Mobile UI pass 2 (version 0.10.0) is such an update too: the Knight's aim rule changed in the sim (the aim follows the
movement), so the tuning fingerprint and `CLIENT_VERSION` changed. Same order: pause the verifier, drain the queue with
the OLD code, merge, deploy the Worker and Pages together, enable the verifier. No D1 migration.

iOS caches an installed web app (Add to Home Screen): after a deploy the app picks up the new build only after it is
fully closed (swiped away) and opened again; the icon, the name and the manifest (display mode, status bar style) are
read when the app is added, so a player may need to remove it and add it to the Home Screen again to get the new
status bar style.

Preview without Cloudflare (nothing is deployed): `npm install`, then `npm run dev` and open
`http://localhost:5173/?hero=knight` or `?hero=wisp` (dev-only override, never saved, absent from production
builds). For the board flow locally: `npx wrangler dev --port 8787 --local` in `server/` and `npm run e2e:board`.
