# Security policy

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue:
use GitHub's **Report a vulnerability** button on the repository's **Security** tab (private vulnerability reporting).
Include what you found, how to reproduce it and what an attacker could do with it. You will get an answer in that
private advisory; please give us a reasonable time to fix it before you talk about it publicly.

## In scope

- The Worker API in `server/` (`/api/daily`, `/api/daily/me`, `/api/submit`, the verifier and admin endpoints):
  injection, authentication or authorization bypass, rate-limit bypass, leaking a player ID or other stored data.
- Replay verification (`tools/verify/`, the deterministic simulation in `src/sim/`): getting a score onto the board
  that the replay does not actually produce, or getting someone else's run rejected or replaced.
- The daily board and the champion message: anything that renders untrusted text as HTML or script, or bypasses the
  name and message rules.
- The static site: weaknesses in the Content-Security-Policy and headers (`public/_headers`).

## Out of scope

- A bot or a tool-assisted player that plays the real game: a run that the deterministic simulation really produces
  is a valid run. (Report it if it bypasses verification instead.)
- Brute force, flooding or denial-of-service against the public endpoints beyond what the rate limits allow.
- Missing best-practice headers or reports from automated scanners without a concrete impact.
- Problems in Cloudflare, GitHub or third-party packages themselves (report those to their maintainers).

## Secrets

No secret lives in this repository. The Worker's `ADMIN_TOKEN`, `IP_SALT` and `VERIFIER_TOKEN` are Cloudflare
secrets and a GitHub Actions secret (see `docs/DEPLOY.md`); local development uses an ignored `.dev.vars` file.
If you ever find a real secret in the repository or its history, report it as above.
