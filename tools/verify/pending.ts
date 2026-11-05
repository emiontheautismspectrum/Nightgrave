/**
 * npm run verify:pending: fetch pending submissions (API_BASE + VERIFIER_TOKEN from the environment), re-simulate each,
 * post the verdict. At most 50 per run; exits quickly when nothing is pending; one bad item never stops the others.
 * The token is never printed.
 */
import { parseItem, verifyItem, type Verdict } from './core';

const API = (process.env.API_BASE ?? '').replace(/\/+$/, '');
const TOKEN = process.env.VERIFIER_TOKEN ?? '';

async function main(): Promise<number> {
  if (!/^https?:\/\//.test(API) || TOKEN.length < 32) {
    console.error('verify: API_BASE (http/https URL) and VERIFIER_TOKEN (>= 32 chars) must be set');
    return 2;
  }
  const headers = { Authorization: `Bearer ${TOKEN}` };
  const r = await fetch(`${API}/api/verify/pending?limit=50`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) {
    console.error(`verify: pending list failed with HTTP ${r.status}`);
    return 1;
  }
  const body = (await r.json()) as { items?: unknown };
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (items.length === 0) {
    console.log('verify: nothing pending');
    return 0;
  }
  let ok = 0;
  let bad = 0;
  let errors = 0;
  for (const raw of items) {
    const id = raw && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : null;
    try {
      const it = parseItem(raw);
      let verdict: Verdict;
      const t0 = performance.now();
      if (!it) verdict = { status: 'rejected', reason: 'invalid_input' };
      else verdict = verifyItem(it);
      const ms = performance.now() - t0;
      if (!id || !/^\d{1,15}-\d{1,15}$/.test(id)) {
        errors++;
        continue;
      }
      const res = await fetch(`${API}/api/verify/result/${id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(verdict.status === 'verified' ? { status: 'verified' } : { status: 'rejected', reason: verdict.reason }),
        signal: AbortSignal.timeout(20_000),
      });
      if (verdict.status === 'verified') ok++;
      else bad++;
      // ids, verdicts and timings only: never the token, never player text
      console.log(`verify: ${id} ${verdict.status}${verdict.status === 'rejected' ? ` (${verdict.reason})` : ''} ${ms.toFixed(1)} ms -> HTTP ${res.status}`);
    } catch (e) {
      errors++;
      console.log(`verify: ${id ?? '?'} error ${e instanceof Error ? e.name : 'unknown'}`);
    }
  }
  console.log(`verify: ${ok} verified, ${bad} rejected, ${errors} errors`);
  return 0;
}

main().then((code) => process.exit(code), () => process.exit(1));
