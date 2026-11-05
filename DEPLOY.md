# Deploying Nightgrave (Cloudflare, free plan)

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

Answer `y` when asked. This applies every file in `server/migrations/` (including `0002_verification.sql`); after
pulling a new version, run it again before `npx wrangler deploy`.

## 5. Create two secrets

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
`IP_SALT` makes the stored IP hashes useless to anyone else; `VERIFIER_TOKEN` lets the replay verifier (step 13) post
its verdicts. The Worker refuses to run without all of them (at least 32 characters each, 16 for the salt).
Secrets are never stored in git.

## 6. Set the allowed origins

Open `server/wrangler.toml` and set `ALLOWED_ORIGINS` to the address your game will have on Pages (step 8), for example:

```toml
ALLOWED_ORIGINS = "https://nightgrave.pages.dev"
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

A wrong or missing token answers `404` (the admin routes do not reveal themselves). The blocked-word list is
`src/shared/profanity.json`: extend it, then rebuild Pages and redeploy the Worker (both use it).

## 11. Custom domain (later)

- Game: Pages project -> **Custom domains** -> add `play.example.com`.
- API: Worker -> **Settings** -> **Domains & Routes** -> add `api.example.com`.
- Then set `ALLOWED_ORIGINS = "https://play.example.com"`, `npx wrangler deploy`, set `VITE_API_BASE` to
  `https://api.example.com` in Pages and redeploy Pages.

## 12. Local development

```bash
cd server && cp .dev.vars.example .dev.vars && npx wrangler d1 migrations apply nightgrave --local && npx wrangler dev --port 8787
```

In a second terminal at the repository root:

```bash
VITE_API_BASE=http://localhost:8787 npm run dev
```

`npm run e2e:board` (with `wrangler dev` running) plays a Hard run in a browser under the production CSP, submits it
and checks it on the local board.

## 13. Replay verification (GitHub Actions)

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

- Workers: 100,000 requests per day. Each title visit costs 1-2 GETs (edge-cached for 30 s), each submit 1 POST.
- D1: 5 GB storage, 5 million rows read and 100,000 rows written per day. The daily cron deletes entries older than
  30 days and rate-limit rows older than 1 day; replays are stored for a later verification stage (up to ~256 KB each,
  but typically a few KB).
- Pages: 500 builds per month.
- Cron triggers: included. If you exceed a limit, requests fail and the game falls back to "Board unavailable".

## Upgrading the game

Every client sends `clientVersion` and the tuning fingerprint. When tuning or `CLIENT_VERSION`
(`src/shared/version.ts`) changes, deploy the Worker and Pages together: old clients get "Game updated: reload the
page" instead of posting incompatible runs.
