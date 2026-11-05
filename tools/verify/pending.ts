/**
 * npm run verify:pending: fetch pending submissions (API_BASE + VERIFIER_TOKEN from the environment), re-simulate each,
 * post the verdict. At most 50 per run; exits quickly when nothing is pending; one bad item never stops the others.
 * The token is never printed.
 */
import { parseItem, verifyItem, type Verdict } from './core';

const API = (process.env.API_BASE ?? '').replace(/\/+$/, '');
const TOKEN = process.env.VERIFIER_TOKEN ?? '';

const BUDGET_MS = 4 * 60 * 1000; // stay inside the workflow's 5 min timeout

async function post(headers: Record<string, string>, id: string, verdict: Verdict): Promise<number> {
  const res = await fetch(`${API}/api/verify/result/${id}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(verdict.status === 'verified' ? { status: 'verified' } : { status: 'rejected', reason: verdict.reason }),
    signal: AbortSignal.timeout(20_000),
  });
  return res.status;
}

async function main(): Promise<number> {
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API);
  if (!(/^https:\/\//.test(API) || local) || TOKEN.length < 32) {
    console.error('verify: API_BASE (https URL; http only for localhost) and VERIFIER_TOKEN (>= 32 chars) must be set');
    return 2;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const start = performance.now();
  const seen = new Set<string>();
  let ok = 0;
  let bad = 0;
  let skipped = 0;
  let errors = 0;
  // keep taking batches of 50 until the queue is empty, only already-seen items remain, or the time budget is spent
  while (performance.now() - start < BUDGET_MS) {
    const r = await fetch(`${API}/api/verify/pending?limit=50`, { headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) {
      console.error(`verify: pending list failed with HTTP ${r.status}`);
      return 1;
    }
    const body = (await r.json()) as { items?: unknown };
    const items = (Array.isArray(body.items) ? body.items.slice(0, 50) : []).filter((raw) => {
      const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : null;
      return typeof id === 'string' && /^\d{1,15}-\d{1,15}$/.test(id) && !seen.has(id);
    }) as { id: string }[];
    if (items.length === 0) break;
    for (const raw of items) {
      const id = raw.id;
      seen.add(id);
      let verdict: Verdict;
      const t0 = performance.now();
      try {
        const it = parseItem(raw);
        verdict = it ? verifyItem(it) : { status: 'rejected', reason: 'invalid_input' };
      } catch (e) {
        // a crash on one item gives it a final verdict, so it can never stall the queue
        verdict = { status: 'rejected', reason: 'error' };
        console.log(`verify: ${id} crashed (${e instanceof Error ? e.name : 'unknown'})`);
      }
      const ms = performance.now() - t0;
      if (verdict.status === 'rejected' && verdict.reason === 'outdated') {
        // this verifier and the run come from different versions (a deploy in progress): leave it pending
        skipped++;
        console.log(`verify: ${id} skipped (other version) ${ms.toFixed(1)} ms`);
        continue;
      }
      try {
        const status = await post(headers, id, verdict);
        if (verdict.status === 'verified') ok++;
        else bad++;
        // ids, verdicts and timings only: never the token, never player text
        console.log(`verify: ${id} ${verdict.status}${verdict.status === 'rejected' ? ` (${verdict.reason})` : ''} ${ms.toFixed(1)} ms -> HTTP ${status}`);
      } catch (e) {
        errors++;
        console.log(`verify: ${id} post failed (${e instanceof Error ? e.name : 'unknown'})`);
      }
    }
  }
  if (ok + bad + skipped + errors === 0) console.log('verify: nothing pending');
  else console.log(`verify: ${ok} verified, ${bad} rejected, ${skipped} skipped (other version), ${errors} errors`);
  return 0;
}

main().then((code) => process.exit(code), () => process.exit(1));
