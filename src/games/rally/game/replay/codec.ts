/**
 * Replay binary codec (DOM-free, runs in node tests). File = magic `RRP` + format byte + flags byte + header length
 * (u32 LE) + header JSON + body. Body = every channel as a column: each value quantised to an integer (`QUANT`), then
 * delta-coded (first or second order: positions and the clock move at a near constant rate, so their second difference
 * is a few units) and written as zigzag LEB128 varints; then gzip (`CompressionStream`, flag bit 1) when available.
 * Slow or smooth channels keep only every `every`-th frame (and the last); decoding fills the frames between linearly.
 * Steps and rates are measured (sources/rally/REPLAY.md): the coarsest that still looks the same in playback.
 */
import {
  CAR_CHANNELS,
  F_TELEPORT,
  REPLAY_FORMAT,
  ROW,
  WHEEL_CHANNELS,
  carCol,
  wheelCol,
  type CarChannel,
  type ReplayHeader,
  type WheelChannel,
} from './format';

/** Quantisation step (value units per integer), delta order and decimation per channel. */
interface Quant {
  step: number;
  order: 1 | 2;
  every: number;
}
const POS: Quant = { step: 0.001, order: 2, every: 1 };
const QUAT: Quant = { step: 1 / 8192, order: 2, every: 1 };
export const WHEEL_QUANT: Record<WheelChannel, Quant> = {
  omega: { step: 0.5, order: 1, every: 2 },
  temp: { step: 1, order: 1, every: 8 },
  disc: { step: 5, order: 1, every: 8 },
};
export const CAR_QUANT: Record<CarChannel, Quant> = {
  rpm: { step: 25, order: 1, every: 2 },
  gear: { step: 1, order: 1, every: 1 },
  effThrottle: { step: 0.02, order: 1, every: 2 },
  throttle: { step: 0.02, order: 1, every: 2 },
  brake: { step: 0.02, order: 1, every: 2 },
  steer: { step: 0.002, order: 1, every: 1 },
  handbrake: { step: 0.05, order: 1, every: 2 },
  impact: { step: 100, order: 1, every: 1 },
  flags: { step: 1, order: 1, every: 1 },
  stageTime: { step: 0.001, order: 2, every: 1 },
  progress: { step: 0.1, order: 2, every: 4 },
};

/** Column list in file order: [row offset, quantisation]. */
const COLUMNS: [number, Quant][] = [
  [0, POS],
  [1, POS],
  [2, POS],
  [3, QUAT],
  [4, QUAT],
  [5, QUAT],
  [6, QUAT],
  ...[0, 1, 2, 3].flatMap((w) =>
    WHEEL_CHANNELS.map(
      (c, ci) => [wheelCol(w, ci), WHEEL_QUANT[c]] as [number, Quant],
    ),
  ),
  ...CAR_CHANNELS.map((c) => [carCol(c), CAR_QUANT[c]] as [number, Quant]),
];

/** Recorded frames: `rows` = frames x ROW numbers (positions need float64: world metres to the millimetre). */
export interface ReplayRows {
  frames: number;
  rows: Float64Array;
}

const MAGIC = [0x52, 0x52, 0x50]; // "RRP"
const FLAG_GZIP = 1;

class ByteWriter {
  buf = new Uint8Array(1 << 16);
  n = 0;
  private grow(k: number): void {
    if (this.n + k <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.n + k) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.n));
    this.buf = b;
  }
  /** Zigzag LEB128 of a signed integer (safe up to 2^52). */
  varint(v: number): void {
    this.grow(8);
    let z = v < 0 ? -2 * v - 1 : 2 * v;
    while (z >= 128) {
      this.buf[this.n++] = (z % 128) | 128;
      z = Math.floor(z / 128);
    }
    this.buf[this.n++] = z;
  }
  bytes(b: Uint8Array): void {
    this.grow(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

class ByteReader {
  i = 0;
  constructor(private b: Uint8Array) {}
  varint(): number {
    let z = 0;
    let mul = 1;
    for (;;) {
      if (this.i >= this.b.length) throw new Error('replay: truncated body');
      const byte = this.b[this.i++];
      z += (byte & 127) * mul;
      if (byte < 128) break;
      mul *= 128;
    }
    return z % 2 === 1 ? -(z + 1) / 2 : z / 2;
  }
}

/** Quaternions keep the hemisphere of the frame before (q and -q are one rotation): no jumps for the deltas. */
function continuousQuats(rows: Float64Array, frames: number): void {
  for (let f = 1; f < frames; f++) {
    const a = (f - 1) * ROW + 3;
    const b = f * ROW + 3;
    const dot =
      rows[a] * rows[b] +
      rows[a + 1] * rows[b + 1] +
      rows[a + 2] * rows[b + 2] +
      rows[a + 3] * rows[b + 3];
    if (dot < 0) for (let k = 0; k < 4; k++) rows[b + k] = -rows[b + k];
  }
}

/** Frames a decimated column keeps: every `every`-th and the last. */
const kept = (f: number, frames: number, every: number): boolean =>
  f % every === 0 || f === frames - 1;

/** The body before compression (also what the size report calls "quantised"). */
export function encodeBody(rec: ReplayRows): Uint8Array {
  const { frames, rows } = rec;
  continuousQuats(rows, frames);
  const w = new ByteWriter();
  for (const [col, q] of COLUMNS) {
    let p1 = 0;
    let p2 = 0;
    let n = 0;
    for (let f = 0; f < frames; f++) {
      if (!kept(f, frames, q.every)) continue;
      const v = Math.round(rows[f * ROW + col] / q.step);
      const pred = q.order === 2 && n > 1 ? 2 * p1 - p2 : p1;
      w.varint(v - pred);
      p2 = p1;
      p1 = v;
      n++;
    }
  }
  return w.done();
}

export function decodeBody(body: Uint8Array, frames: number): Float64Array {
  const rows = new Float64Array(frames * ROW);
  const r = new ByteReader(body);
  for (const [col, q] of COLUMNS) {
    let p1 = 0;
    let p2 = 0;
    let n = 0;
    let lastKept = -1;
    for (let f = 0; f < frames; f++) {
      if (!kept(f, frames, q.every)) continue;
      const pred = q.order === 2 && n > 1 ? 2 * p1 - p2 : p1;
      const v = pred + r.varint();
      const x = v * q.step;
      rows[f * ROW + col] = x;
      // Frames between two kept ones: a straight line.
      if (lastKept >= 0 && f - lastKept > 1) {
        const x0 = rows[lastKept * ROW + col];
        for (let g = lastKept + 1; g < f; g++)
          rows[g * ROW + col] =
            x0 + ((x - x0) * (g - lastKept)) / (f - lastKept);
      }
      lastKept = f;
      p2 = p1;
      p1 = v;
      n++;
    }
  }
  return rows;
}

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Response(
    new Blob([data as BlobPart]).stream().pipeThrough(stream),
  );
  return new Uint8Array(await out.arrayBuffer());
}

export const canGzip = (): boolean =>
  typeof CompressionStream !== 'undefined' &&
  typeof DecompressionStream !== 'undefined';

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('gzip'));
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('gzip'));
}

/** A stored replay aims under this (bytes): longer runs keep every other frame until it fits (`encodeReplay`). */
export const REPLAY_BUDGET = 100 * 1024;
/** Never thinner than this many physics steps per frame (240 Hz / 8 = 30 Hz). */
const MAX_STRIDE = 8;

/**
 * Every other frame (and the last): half the rate. A dropped frame's teleport flag and impact move to the next kept
 * frame, so playback still cuts at a reset and every crash still sounds.
 */
export function thinFrames(rec: ReplayRows): ReplayRows {
  const { frames, rows } = rec;
  const keep: number[] = [];
  for (let f = 0; f < frames; f++)
    if (f % 2 === 0 || f === frames - 1) keep.push(f);
  const out = new Float64Array(keep.length * ROW);
  const fl = carCol('flags');
  const imp = carCol('impact');
  let prev = -1;
  keep.forEach((f, k) => {
    out.set(rows.subarray(f * ROW, (f + 1) * ROW), k * ROW);
    for (let g = prev + 1; g < f; g++) {
      out[k * ROW + fl] = out[k * ROW + fl] | (rows[g * ROW + fl] & F_TELEPORT);
      out[k * ROW + imp] = Math.max(out[k * ROW + imp], rows[g * ROW + imp]);
    }
    prev = f;
  });
  return { frames: keep.length, rows: out };
}

/** Header + rows -> the stored file (gzipped where the platform can), thinned to fit `budget`. */
export async function encodeReplay(
  header: ReplayHeader,
  rec: ReplayRows,
  budget = REPLAY_BUDGET,
): Promise<Uint8Array> {
  let file = await encodeOnce(header, rec);
  let h = header;
  let r = rec;
  while (file.length > budget && h.stride * 2 <= MAX_STRIDE && r.frames > 2) {
    r = thinFrames(r);
    h = { ...h, stride: h.stride * 2 };
    file = await encodeOnce(h, r);
  }
  return file;
}

async function encodeOnce(
  header: ReplayHeader,
  rec: ReplayRows,
): Promise<Uint8Array> {
  const raw = encodeBody({ frames: rec.frames, rows: rec.rows.slice() });
  const zip = canGzip();
  const body = zip ? await gzip(raw) : raw;
  const head = new TextEncoder().encode(
    JSON.stringify({ ...header, frames: rec.frames }),
  );
  const out = new Uint8Array(9 + head.length + body.length);
  out.set(MAGIC, 0);
  out[3] = REPLAY_FORMAT;
  out[4] = zip ? FLAG_GZIP : 0;
  new DataView(out.buffer).setUint32(5, head.length, true);
  out.set(head, 9);
  out.set(body, 9 + head.length);
  return out;
}

/** Only the header (lists of saved replays, no body decode). */
export function readHeader(file: Uint8Array): ReplayHeader {
  if (MAGIC.some((m, i) => file[i] !== m))
    throw new Error('replay: not a replay file');
  if (file[3] !== REPLAY_FORMAT)
    throw new Error(
      `replay: format ${file[3]}, this game reads ${REPLAY_FORMAT}`,
    );
  const len = new DataView(file.buffer, file.byteOffset).getUint32(5, true);
  return JSON.parse(
    new TextDecoder().decode(file.subarray(9, 9 + len)),
  ) as ReplayHeader;
}

export interface DecodedReplay {
  header: ReplayHeader;
  rows: Float64Array;
}

export async function decodeReplay(file: Uint8Array): Promise<DecodedReplay> {
  const header = readHeader(file);
  const len = new DataView(file.buffer, file.byteOffset).getUint32(5, true);
  let body = file.subarray(9 + len);
  if (file[4] & FLAG_GZIP) body = await gunzip(body);
  return { header, rows: decodeBody(body, header.frames) };
}

const TEXT_PREFIX = 'rally-replay:';

/** Clipboard / console text form: prefix + base64 of the file. */
export function replayToText(file: Uint8Array): string {
  let s = '';
  for (let i = 0; i < file.length; i += 0x8000)
    s += String.fromCharCode(...file.subarray(i, i + 0x8000));
  return TEXT_PREFIX + btoa(s);
}

export function replayFromText(text: string): Uint8Array {
  const t = text.trim();
  const b64 = t.startsWith(TEXT_PREFIX) ? t.slice(TEXT_PREFIX.length) : t;
  const s = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
