"""
Roads OSM does not have, from Microsoft ML Road Detections (used by bake.py, config `msRoads`).

Source: https://github.com/microsoft/RoadDetections (ODbL) - roads detected in Bing Maps imagery (2020-2022), no
type / surface / name, some false detections. Read from the per-country GeoParquet mirror on Source Cooperative
(`country` = Microsoft's region code, mostly ISO alpha-3), cached in scripts/realmap/.cache/. Needs pyarrow >= 21.

Only the parts farther than `clearance` m from every OSM road and the stage road are kept (OSM wins: it has the
tags); each kept run is extended back along the detection to where it meets the OSM road and snapped onto it, so it
joins the network instead of ending in a field. Runs shorter than `minLength` m are dropped (noise, driveways). The
detections are traced from an imagery mask and zig-zag: runs are smoothed in plan (ends fixed, so joints stay closed).
"""

import os

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.spatial import cKDTree

URL = 'https://data.source.coop/nlebovits/microsoft-ml-road-detections/road-detections/by_country/country={0}/{0}.parquet'
CREDIT = 'Roads where OSM has none: Microsoft ML Road Detections (ODbL)'


def load(country, cache, fetch, box):
    """Detections inside the lat / lon box (lat0, lat1, lon0, lon1) -> list of (N, 2) lon / lat arrays."""
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    import shapely

    path = os.path.join(cache, f'ms_roads_{country}.parquet')
    fetch(URL.format(country), path)
    t = pq.read_table(path, columns=['bbox', 'geometry'])
    bb = t.column('bbox').combine_chunks()
    lat0, lat1, lon0, lon1 = box
    inside = pc.and_(
        pc.and_(pc.greater(bb.field('xmax'), lon0), pc.less(bb.field('xmin'), lon1)),
        pc.and_(pc.greater(bb.field('ymax'), lat0), pc.less(bb.field('ymin'), lat1)),
    )
    geoms = shapely.from_wkb(t.filter(inside).column('geometry').to_numpy(zero_copy_only=False))
    return [np.asarray(g.coords)[:, :2] for g in geoms if g is not None and not g.is_empty]


def smooth(run, sigma=3.0):
    """Gaussian-smoothed polyline (sigma in samples), first and last point kept in place."""
    if len(run) < 5:
        return run
    out = np.stack([gaussian_filter1d(run[:, k], sigma, mode='nearest') for k in (0, 1)], 1)
    # Blend back to the original near the ends so the snapped joints do not move.
    n = len(run)
    w = np.minimum(1.0, np.minimum(np.arange(n), np.arange(n)[::-1]) / (2 * sigma))[:, None]
    return run * (1 - w) + out * w


def missing_roads(lines, known, resample, clearance=15.0, min_length=40.0):
    """
    lines: detections in world x / z; known: OSM roads + stage road (world x / z polylines).
    -> runs of the detections that OSM lacks, each joined to the nearest known road at the end(s) it came from.
    """
    pts = [resample(np.asarray(p, float), 2.0) for p in known if len(p) > 1]
    kd = cKDTree(np.vstack(pts))
    kept_kd = None
    out = []
    for line in lines:
        if len(line) < 2:
            continue
        q = resample(np.asarray(line, float), 2.0)
        d, idx = kd.query(q)
        far = d > clearance
        if kept_kd is not None:  # overlapping detections: the first one wins
            far &= kept_kd.query(q)[0] > clearance
        i = 0
        while i < len(q):
            if not far[i]:
                i += 1
                continue
            j = i
            while j + 1 < len(q) and far[j + 1]:
                j += 1
            a, b = i, j
            # Walk back to where the detection meets the OSM road (the distance stops falling).
            while a > 0 and d[a - 1] < d[a]:
                a -= 1
            while b + 1 < len(q) and d[b + 1] < d[b]:
                b += 1
            run = q[a : b + 1]
            # Snap the joining end(s) onto the OSM road so the junction closes.
            if a < i and d[a] < clearance + 5:
                run = np.vstack([kd.data[idx[a]], run])
            if b > j and d[b] < clearance + 5:
                run = np.vstack([run, kd.data[idx[b]]])
            run = smooth(resample(run, 2.0))
            length = float(np.linalg.norm(np.diff(run, axis=0), axis=1).sum())
            if length >= min_length:
                out.append(run)
                kept_kd = cKDTree(np.vstack(out))
            i = j + 1
    return out
