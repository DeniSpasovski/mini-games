import {
  BufferAttribute,
  BufferGeometry,
  type InterleavedBufferAttribute,
} from 'three';

/**
 * People close up are built in a worker (people-worker.ts), where there is no material: a part carries the look of its
 * material (`skin|<model>|<tone>`, `atlas`, `flag`) and the main thread picks it (people-pool.ts). This is the part of
 * the trip both ends share: geometry as plain transferable arrays.
 */
export interface WirePart {
  attrs: {
    name: string;
    array: ArrayBufferView;
    itemSize: number;
    normalized: boolean;
  }[];
  index: Uint16Array | Uint32Array | null;
  look: string;
}

export function toWire(
  geometry: BufferGeometry,
  look: string,
  buffers: ArrayBuffer[],
): WirePart {
  const attrs = Object.entries(geometry.attributes).map(([name, a]) => {
    if ((a as InterleavedBufferAttribute).isInterleavedBufferAttribute)
      throw new Error(`attribute ${name} is interleaved`);
    const attr = a as BufferAttribute;
    buffers.push(attr.array.buffer as ArrayBuffer);
    return {
      name,
      array: attr.array,
      itemSize: attr.itemSize,
      normalized: attr.normalized,
    };
  });
  const index = geometry.index?.array as Uint16Array | Uint32Array | undefined;
  if (index) buffers.push(index.buffer as ArrayBuffer);
  return { attrs, index: index ?? null, look };
}

export function fromWire(p: WirePart): BufferGeometry {
  const g = new BufferGeometry();
  for (const a of p.attrs)
    g.setAttribute(
      a.name,
      new BufferAttribute(
        a.array as ConstructorParameters<typeof BufferAttribute>[0],
        a.itemSize,
        a.normalized,
      ),
    );
  if (p.index) g.setIndex(new BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  return g;
}
