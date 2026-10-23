"""Outline a title in a font into a white SVG wordmark (the portal's game covers and header).

  python3 scripts/portal/wordmarks.py <font.woff2> "<text>" <out.svg> [--wdth N] [--wght N] [--upper]

Needs fonttools + brotli. A variable font is pinned to --wdth / --wght first. Kerning is not applied. The viewBox is a fixed band round the baseline (1000-unit em), so the same CSS height gives the same type size in every wordmark.
Fonts used (all SIL OFL): Barlow Condensed 800 italic (rally), Fredoka 700 (hole), Grandstander 800 (kaboom),
Archivo wdth 125 / wght 800 (portal) - the first two are in the games' assets/fonts, the others from Fontsource.
"""

import argparse

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ap = argparse.ArgumentParser()
ap.add_argument('font')
ap.add_argument('text')
ap.add_argument('out')
ap.add_argument('--wdth', type=float)
ap.add_argument('--wght', type=float)
ap.add_argument('--upper', action='store_true')
a = ap.parse_args()

font = TTFont(a.font)
if 'fvar' in font:
    limits = {}
    if a.wdth is not None:
        limits['wdth'] = a.wdth
    if a.wght is not None:
        limits['wght'] = a.wght
    font = instancer.instantiateVariableFont(font, limits)
gs = font.getGlyphSet()
cmap = font.getBestCmap()
upm = font['head'].unitsPerEm
k = 1000 / upm  # every font on a 1000-unit em, so one CSS font-size means the same size for every wordmark
UP, DOWN = 820, 200  # band above / below the baseline (cap height is about 700)
text = a.text.upper() if a.upper else a.text

x = 0
pen = SVGPathPen(gs, ntos=lambda v: f'{v:.0f}')
for ch in text:
    name = cmap[ord(ch)]
    # flip y: font units are y-up, SVG y-down; baseline at y = UP
    gs[name].draw(TransformPen(pen, (k, 0, 0, -k, x, UP)))
    x += font['hmtx'][name][0] * k

w, h = round(x), UP + DOWN
svg = (
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" role="img" aria-label="{a.text}">'
    f'<path fill="#fff" d="{pen.getCommands()}"/></svg>\n'
)
open(a.out, 'w').write(svg)
print(a.out, w, h, len(svg))
