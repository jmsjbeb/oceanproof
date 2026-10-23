# -*- coding: utf-8 -*-
"""
从 Natural Earth 50m 陆地数据生成前端用的海岸线多边形（land.js）。

输入 : tools/ne_50m_land.geojson   (Natural Earth 1:50m land, public domain)
输出 : land.js  ->  OP.LAND_WORLD = [{p:[[lon,lat],...], jp:0|1}, ...]

裁剪范围略大于地图视野（100–170°E / 15–45°N），留出边缘余量；
简化容差 0.012°（约 1.3 km），足够 0.2° 网格与 1400×600 的 SVG 使用。
"""
import json
import os
import sys

from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely.ops import unary_union

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, "ne_50m_land.geojson")
OUT = os.path.join(ROOT, "land.js")

CLIP = box(96.0, 8.0, 184.0, 50.0)
TOL = 0.012
MIN_AREA = 0.0015          # deg^2，滤掉礁石级碎岛
JP_BOX = (127.0, 24.0, 147.0, 46.0)


def rings_of(geom):
    """展平成外环列表（忽略内环/湖泊，本尺度无影响）"""
    out = []
    if isinstance(geom, Polygon):
        out.append(geom.exterior)
    elif isinstance(geom, MultiPolygon):
        for g in geom.geoms:
            out.append(g.exterior)
    return out


def is_japan(ring):
    """整环落在日本列岛包围盒内即视为日本（用于分色）"""
    x0, y0, x1, y1 = ring.bounds
    return (x0 >= JP_BOX[0] and y0 >= JP_BOX[1]
            and x1 <= JP_BOX[2] and y1 <= JP_BOX[3])


def main():
    if not os.path.exists(SRC):
        sys.exit("缺少 %s，请先下载 ne_50m_land.geojson" % SRC)

    with open(SRC, "r", encoding="utf-8") as f:
        gj = json.load(f)

    geoms = []
    for feat in gj["features"]:
        g = shape(feat["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        if g.intersects(CLIP):
            geoms.append(g)

    # 合并后再裁剪，避免同一块陆地被切成重叠碎片
    merged = unary_union(geoms).intersection(CLIP)

    polys = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    polys.sort(key=lambda p: -p.area)

    out = []
    total = 0
    for p in polys:
        if p.area < MIN_AREA:
            continue
        sp = p.simplify(TOL, preserve_topology=True)
        for ring in rings_of(sp):
            pts = [[round(x, 2), round(y, 2)] for x, y in ring.coords]
            # 去掉简化后重复的相邻点
            ded = [pts[0]]
            for q in pts[1:]:
                if q != ded[-1]:
                    ded.append(q)
            if len(ded) < 4:
                continue
            out.append({"p": ded, "jp": 1 if is_japan(ring) else 0})
            total += len(ded)

    body = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    js = ("/* 海岸线：Natural Earth 1:50m land（public domain），"
          "经 tools/build_land.py 裁剪简化。\n"
          "   范围 96–184°E / 8–50°N，容差 %s°，共 %d 个环 / %d 个顶点。\n"
          "   仅用于示意与栅格掩膜，不作导航用途。 */\n"
          "OP.LAND_WORLD = %s;\n" % (TOL, len(out), total, body))

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    kb = os.path.getsize(OUT) / 1024.0
    print("rings=%d vertices=%d  %.1f KB -> %s" % (len(out), total, kb, OUT))


if __name__ == "__main__":
    main()
