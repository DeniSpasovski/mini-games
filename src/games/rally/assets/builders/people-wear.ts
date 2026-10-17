import { Matrix4, type BufferGeometry } from 'three';
import { paint } from '../../engine/geo';
import type { ScanModel } from '../../engine/people-scan-material';
import type { Outfit } from './people';
import {
  BAG,
  HAT,
  HIVIS,
  JACKET,
  KNIT,
  REFLECT,
  block,
  tag,
  tube,
  v3,
} from './people-parts';
import {
  BONE,
  headShell,
  scanRig,
  skirtShell,
  torsoDepth,
  torsoShell,
  torsoStrap,
  type ScanBody,
} from './people-scan';

/**
 * What a scanned figure wears on top of its own clothes: hats, glasses, a hi-vis vest, stripes, a scarf, a skirt, a
 * backpack. Built in the rest frame and carried by the posed bones, so they follow the pose.
 */
export function dress(
  o: Outfit,
  m: ScanModel,
  body: ScanBody,
  broad: number,
  hi: boolean,
): BufferGeometry[] {
  const rig = scanRig(m);
  const out: BufferGeometry[] = [];
  const on = (g: BufferGeometry, bone: number): void => {
    g.applyMatrix4(body.bones[bone]);
    out.push(g);
  };
  const seg = hi ? 14 : 8;
  const rows = hi ? 7 : 4;
  const eye = rig.eyeY;
  const front = rig.faceZ;
  const shell = (
    y0: number,
    grow: number,
    color: string,
    cell: number,
    open = 0,
    y1?: number,
    n = rows,
  ): BufferGeometry =>
    tag(paint(headShell(m, y0, grow, seg, open, n, y1), color), cell);

  // Head wear.
  if (o.hat === 'cap') {
    const rim = eye + 0.04;
    on(shell(rim, 0.012, o.hatColor, HAT), BONE.head);
    on(
      block(
        0.18,
        0.012,
        0.09,
        v3(0, rim - 0.004, front + 0.045),
        o.hatColor,
        new Matrix4().makeRotationX(0.12),
      ),
      BONE.head,
    );
  } else if (o.hat === 'beanie') {
    const rim = eye + 0.022;
    on(shell(rim, 0.016, o.hatColor, KNIT), BONE.head);
    on(shell(rim, 0.026, o.hatColor, KNIT, 0, rim + 0.045, 1), BONE.head);
  } else if (o.hat === 'helmet') {
    const rim = eye - 0.01;
    on(shell(rim, 0.03, o.hatColor, HAT), BONE.head);
    on(
      block(0.17, 0.05, 0.06, v3(0, rim + 0.06, front + 0.04), '#1c2630'),
      BONE.head,
    );
  } else if (o.hat === 'hood') {
    // Open at the front so the face shows.
    on(shell(rig.neck.y + 0.05, 0.036, o.hatColor, KNIT, 1.05), BONE.head);
  }
  if (o.glasses) {
    const y = rig.eyeY;
    const z = rig.faceZ + 0.012;
    on(block(0.026, 0.01, 0.012, v3(0, y + 0.008, z), '#15171a'), BONE.head);
    for (const s of [-1, 1]) {
      on(block(0.058, 0.036, 0.014, v3(s * 0.04, y, z), '#15171a'), BONE.head);
      on(
        block(0.008, 0.008, 0.1, v3(s * 0.075, y + 0.004, z - 0.05), '#15171a'),
        BONE.head,
      );
    }
  }

  // Torso wear.
  const y1 = rig.chest - 0.01;
  if (o.jacket && m === 'female')
    on(
      tag(
        paint(
          torsoShell(
            m,
            0,
            y1 - 0.01,
            0.012,
            broad,
            6,
            (ang) => 0.05 * Math.max(0, Math.cos(ang)) ** 2,
          ),
          o.torso,
        ),
        JACKET,
      ),
      BONE.spine,
    );
  if (o.vest) {
    // A tabard: a V at the front, lower at the back, up to the shoulders at the sides.
    const neck = (ang: number): number =>
      0.1 * Math.max(0, Math.cos(ang)) ** 2 +
      0.05 * Math.max(0, -Math.cos(ang)) ** 2;
    on(
      tag(
        paint(torsoShell(m, 0.05, y1 + 0.03, 0.022, broad, 6, neck), o.vest),
        HIVIS,
      ),
      BONE.spine,
    );
    if (hi && o.bands)
      for (const y of [0.17, 0.31])
        on(
          tag(
            paint(torsoShell(m, y, y + 0.045, 0.027, broad, 1), '#e6e8ea'),
            HIVIS,
          ),
          BONE.spine,
        );
    for (const s of [-1, 1])
      on(
        block(
          0.07,
          0.02,
          0.24,
          v3(s * 0.1 * broad, y1 + 0.032, rig.neck.z),
          o.vest,
          undefined,
          HIVIS,
        ),
        BONE.spine,
      );
  } else if (hi && o.stripe) {
    on(
      tag(paint(torsoShell(m, 0.24, 0.3, 0.007, broad, 1), o.stripe), KNIT),
      BONE.spine,
    );
  }
  if (o.collar)
    on(
      tube(
        v3(0, rig.neck.y - 0.03, rig.neck.z),
        v3(0, rig.neck.y + 0.025, rig.neck.z),
        rig.neckR + 0.01,
        rig.neckR + 0.004,
        o.collar,
        hi ? 10 : 6,
        1,
        KNIT,
      ),
      BONE.spine,
    );
  if (o.pack) {
    const d = torsoDepth(m);
    on(
      block(
        0.28 * broad,
        0.34,
        0.11,
        v3(0, 0.3, d.back - 0.055),
        o.pack,
        undefined,
        BAG,
      ),
      BONE.spine,
    );
    on(
      block(
        0.2 * broad,
        0.14,
        0.05,
        v3(0, 0.17, d.back - 0.15),
        o.pack,
        undefined,
        BAG,
      ),
      BONE.spine,
    );
    for (const s of [-1, 1]) {
      // Straps over the shoulder and down the chest.
      on(
        tag(
          paint(
            torsoStrap(m, s * 0.55, 0.2, 0.26, y1 - 0.01, 0.012, broad),
            '#1c1e22',
          ),
          BAG,
        ),
        BONE.spine,
      );
      on(
        block(
          0.04,
          0.02,
          0.2,
          v3(s * 0.12 * broad, y1 + 0.03, rig.neck.z),
          '#1c1e22',
          undefined,
          BAG,
        ),
        BONE.spine,
      );
    }
  }
  if (o.skirt) {
    const len = o.skirtLen ?? 0.5;
    on(
      tag(
        paint(
          skirtShell(
            m,
            rig.waist,
            len,
            0.02 + len * 0.05,
            body.geometry.getAttribute('position').array,
            !hi,
          ),
          o.skirt,
        ),
        REFLECT,
      ),
      BONE.pelvis,
    );
  }
  return out;
}
