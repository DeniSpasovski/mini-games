"""Textures of the baked trucks: re-encode the source images and cut the tint masks.

    python scripts/car-model/bake-truck-textures.py <dir>

<dir> holds low_<i>.png / dump_<i>.png (street-pack-extract.py --images). Writes <dir>/textures.json:
{key: {map: data URI (jpeg), mask: data URI (png, 255 = the texel takes the vehicle's paint colour) or null, ref: number}}
which bake-trucks.mjs embeds. `ref` = the 55th percentile of the linear luminance of the tinted texels: the shader
divides by it, so the brightest panels come out at the paint colour and the shading of the texture stays.

A mask is the light, neutral texels in blobs of at least MIN_PX (panels; lamps, stripes and signs are small), minus the
`keep` rectangles (fractions of the image: grille and lamp panel, bumpers). Logos: the hub caps in the tyre texture are
blanked (`blank`: centre + radius as fractions).
"""
import base64
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

MIN_PX = 1500

SPECS = {
    'lowBody': dict(src='low_0', size=1024, mask=True, keep=[(0.40, 0.52, 0.63, 0.69)]),
    'lowTrailer': dict(src='low_2', size=1024, mask=True, keep=[(0.0, 0.0, 0.34, 0.12), (0.61, 0.38, 1.0, 0.55)]),
    'lowTyre': dict(src='low_3', size=512, blank=[(0.707, 0.264, 0.05), (0.289, 0.703, 0.05)]),
    'dumpDirt': dict(src='dump_0', size=512),
    'dumpYellow': dict(src='dump_2', size=512),
    'dumpTyre': dict(src='dump_4', size=512),
}


def uri(img, fmt, **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return f'data:image/{fmt.lower()};base64,' + base64.b64encode(buf.getvalue()).decode()


def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def tint_mask(rgb, keep):
    f = rgb.astype(np.float32)
    lum = 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]
    chroma = f.max(-1) - f.min(-1)
    m = (lum >= 70) & (chroma <= 34)
    m = ndi.binary_closing(m, structure=np.ones((3, 3)))
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    big = np.zeros(n + 1, bool)
    big[1:] = sizes >= MIN_PX * (rgb.shape[0] / 1024) ** 2
    m = big[lab]
    h, w = m.shape
    for x0, y0, x1, y1 in keep:
        m[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)] = False
    return m


out = {}
d = sys.argv[1]
for key, s in SPECS.items():
    im = Image.open(os.path.join(d, s['src'] + '.png')).convert('RGB')
    for cx, cy, r in s.get('blank', []):
        a = np.asarray(im).copy()
        h, w = a.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        disc = (xx - cx * w) ** 2 + (yy - cy * h) ** 2 <= (r * w) ** 2
        a[disc] = (52, 52, 54)
        im = Image.fromarray(a)
    full = np.asarray(im)
    mask = tint_mask(full, s.get('keep', [])) if s.get('mask') else None
    size = s['size']
    small = im.resize((size, size), Image.LANCZOS) if im.size[0] != size else im
    entry = dict(map=uri(small, 'JPEG', quality=86, optimize=True, subsampling=0 if size >= 1024 else 2), mask=None, ref=1.0)
    if mask is not None:
        lin = srgb_to_linear(full.astype(np.float32))
        lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
        entry['ref'] = round(float(np.percentile(lum[mask], 55)), 4)
        mimg = Image.fromarray((mask * 255).astype(np.uint8)).resize((512, 512), Image.LANCZOS)
        entry['mask'] = uri(mimg, 'PNG', optimize=True)
    else:
        lin = srgb_to_linear(np.asarray(small).astype(np.float32))
        lum = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
        entry['ref'] = round(float(np.percentile(lum, 55)), 4)
    out[key] = entry
    print(key, 'map', len(entry['map']) // 1024, 'KB', 'mask', len(entry['mask'] or '') // 1024, 'KB', 'ref', entry['ref'])
json.dump(out, open(os.path.join(d, 'textures.json'), 'w'))
