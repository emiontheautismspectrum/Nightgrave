/**
 * Compact binary replay input log: run-length encoding of identical consecutive input frames, then base64.
 * Per run: varint count, one flag byte (bit0 cursor, bits1-2 buttons), zigzag varint mx, zigzag varint my.
 * Pure (no DOM): btoa/atob exist in browsers, Workers and Node.
 */
import { AXIS_MAX, sanitizeInput, type InputFrame } from '../sim/input';

export const MAX_REPLAY_BYTES = 256 * 1024;

function pushVar(out: number[], v: number): void {
  let x = v >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
}
const zig = (v: number): number => ((v << 1) ^ (v >> 31)) >>> 0;
const unzig = (v: number): number => (v >>> 1) ^ -(v & 1);

export function encodeInputLog(frames: readonly InputFrame[]): string {
  const out: number[] = [];
  let i = 0;
  while (i < frames.length) {
    const f = sanitizeInput(frames[i]);
    let n = 1;
    while (i + n < frames.length) {
      const g = sanitizeInput(frames[i + n]);
      if (g.cursor !== f.cursor || g.mx !== f.mx || g.my !== f.my || g.buttons !== f.buttons) break;
      n++;
    }
    pushVar(out, n);
    out.push((f.cursor ? 1 : 0) | (f.buttons << 1));
    pushVar(out, zig(f.mx));
    pushVar(out, zig(f.my));
    i += n;
  }
  let bin = '';
  for (let k = 0; k < out.length; k += 0x8000) bin += String.fromCharCode(...out.slice(k, k + 0x8000));
  return btoa(bin);
}

/** Decode an untrusted base64 log. Returns null on any malformed input (never throws). */
export function decodeInputLog(b64: string, maxTicks = 60 * 60 * 120, strict = false): InputFrame[] | null {
  let bin: string;
  try {
    if (typeof b64 !== 'string' || b64.length > Math.ceil((MAX_REPLAY_BYTES * 4) / 3) + 4) return null;
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length > MAX_REPLAY_BYTES) return null;
  let p = 0;
  const readVar = (): number | null => {
    let v = 0;
    for (let s = 0; s < 35; s += 7) {
      if (p >= bin.length) return null;
      const b = bin.charCodeAt(p++);
      v += (b & 0x7f) * 2 ** s;
      if (!(b & 0x80)) return v > 0xffffffff ? null : v;
    }
    return null;
  };
  const frames: InputFrame[] = [];
  while (p < bin.length) {
    const n = readVar();
    if (n === null || n < 1 || frames.length + n > maxTicks || p >= bin.length) return null;
    const flags = bin.charCodeAt(p++);
    if (flags > 7) return null;
    const mx = readVar();
    const my = readVar();
    if (mx === null || my === null) return null;
    const cursor = (flags & 1) === 1;
    const x = unzig(mx);
    const y = unzig(my);
    // strict (the verifier): a cursor must lie on the 480x270 screen, an axis within +-AXIS_MAX; never "fixed up"
    if (strict && (cursor ? x < 0 || x > 480 || y < 0 || y > 270 : Math.abs(x) > AXIS_MAX || Math.abs(y) > AXIS_MAX)) return null;
    const f = sanitizeInput({ cursor, mx: x, my: y, buttons: flags >> 1 });
    for (let k = 0; k < n; k++) frames.push({ ...f });
  }
  return frames;
}

/**
 * Tick count of an encoded log WITHOUT materialising frames (cheap: sums run lengths, validates the structure).
 * Stops with null as soon as the total exceeds maxTicks.
 */
export function countTicks(b64: string, maxTicks = 60 * 60 * 120): number | null {
  let bin: string;
  try {
    if (typeof b64 !== 'string' || b64.length > Math.ceil((MAX_REPLAY_BYTES * 4) / 3) + 4) return null;
    bin = atob(b64);
  } catch {
    return null;
  }
  let p = 0;
  const readVar = (): number | null => {
    let v = 0;
    for (let s = 0; s < 35; s += 7) {
      if (p >= bin.length) return null;
      const b = bin.charCodeAt(p++);
      v += (b & 0x7f) * 2 ** s;
      if (!(b & 0x80)) return v > 0xffffffff ? null : v;
    }
    return null;
  };
  let total = 0;
  while (p < bin.length) {
    const n = readVar();
    if (n === null || n < 1 || p >= bin.length) return null;
    total += n;
    if (total > maxTicks) return null;
    if (bin.charCodeAt(p++) > 7) return null;
    if (readVar() === null || readVar() === null) return null;
  }
  return total;
}
