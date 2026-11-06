/**
 * Fitting untrusted text into a fixed number of lines (pure, no Phaser): word wrap at `maxChars` per line, at most
 * `maxLines` lines, a clean "..." when it is cut. Words longer than a line are broken. Used for the champion's message.
 */
export function clampLines(text: string, maxChars: number, maxLines: number): string[] {
  const n = Math.max(4, Math.floor(maxChars));
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w !== '');
  const out: string[] = [];
  let cur = '';
  let cut = false;
  for (let i = 0; i < words.length; i++) {
    let w = words[i]!;
    while (w.length > n) {
      // a word longer than a line: break it
      if (cur) {
        out.push(cur);
        cur = '';
      }
      out.push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= n) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
    if (out.length >= maxLines) {
      cut = true;
      break;
    }
  }
  if (!cut && cur) out.push(cur);
  if (out.length > maxLines) {
    out.length = maxLines;
    cut = true;
  }
  if (cut && out.length) {
    const last = out[out.length - 1]!;
    out[out.length - 1] = last.length + 3 <= n ? `${last}...` : `${last.slice(0, n - 3).trimEnd()}...`;
  }
  return out;
}
