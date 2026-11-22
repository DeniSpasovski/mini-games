/**
 * The binary file next to a baked `*.data.ts` (`scripts/data/data-bin.mjs` moves the packed meshes out of the script
 * into `<name>.data.bin`). The data module awaits `loadBin` at its top level and hands out views into the one buffer.
 */
export type Bin = (offset: number, length: number) => Uint8Array;

export async function loadBin(url: URL): Promise<Bin> {
  const bytes = await read(url);
  return (offset, length) => bytes.subarray(offset, offset + length);
}

async function read(url: URL): Promise<Uint8Array> {
  if (url.protocol === 'file:') {
    // Node (tests, scripts): the file itself.
    const fs = await import(/* webpackIgnore: true */ 'node:fs/promises');
    const buf = await fs.readFile(url);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A `DataView` over exactly these bytes (a `Bin` view starts inside its file's buffer). */
export const dataView = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
