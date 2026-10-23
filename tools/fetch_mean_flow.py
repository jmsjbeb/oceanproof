#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_mean_flow.py — 用**实测日频表层流**的月度快照，构建季节平均流场，
并据此积分出各条输运路径的**数据驱动抵达时间**。

思路
----
1. 取 12 个月（或 24 个半月）各一张实测流场快照，平均成"季节平均流场"；
2. 沿每条输运路径折线做线积分  T = ∫ ds / (v⃗·t̂)，
   v⃗ 取平均流场双线性插值，投影到路径切向，并设下限防止停滞段发散；
3. 把积分结果与文献锚点（中国沿岸 240 d）对比——如果吻合，
   说明"路径 + 标定速度"这套简化确实抓住了真实环流的主干。

输出
----
`meanflow.js`  ->  OP.MEANFLOW = { 网格 + u/v(base64 Int16) + 每条路径的积分天数 }
"""

import base64
import json
import os
import sys
import time
from datetime import date, datetime, timedelta

import numpy as np

try:
    import netCDF4
except ImportError:
    sys.exit("需要 netCDF4")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily"
TMP = os.path.join(HERE, "cache", "flow")
LON0, LON1 = 100.0, 180.0
LAT0, LAT1 = 48.0, 8.0
STRIDE = 2                      # 0.5°
SCALE = 0.01
NAN = -32768


def url(d, stride=STRIDE):
    t = "%5B({})%5D".format(d)
    y = "%5B({}):{}:({})%5D".format(LAT1, stride, LAT0)
    x = "%5B({}):{}:({})%5D".format(LON0, stride, LON1)
    return BASE + ".nc?u_current{}{}{},v_current{}{}{}".format(t, y, x, t, y, x)


def grab(d):
    import urllib.request
    fp = os.path.join(TMP, d + ".nc")
    if os.path.exists(fp) and os.path.getsize(fp) > 5000:
        return fp
    for k in range(3):
        try:
            req = urllib.request.Request(url(d), headers={"User-Agent": "OceanProof/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                blob = r.read()
            if len(blob) < 5000:
                raise IOError("too small")
            with open(fp, "wb") as f:
                f.write(blob)
            return fp
        except Exception as e:      # noqa: BLE001
            print("    重试 %s (%s)" % (d, type(e).__name__), flush=True)
            time.sleep(2)
    return None


def main():
    os.makedirs(TMP, exist_ok=True)
    dates = []
    d = date(2023, 8, 15)
    while d <= date(2024, 9, 15):
        dates.append(d.isoformat())
        y, m = (d.year + (d.month == 12)), (d.month % 12 + 1)
        d = date(y, m, 15)

    print("取 %d 个月度快照（%.2f° 网格）" % (len(dates), 0.25 * STRIDE), flush=True)
    us, vs = [], []
    lat = lon = None
    for i, ds in enumerate(dates):
        fp = grab(ds)
        if not fp:
            print("  %s 失败，跳过" % ds, flush=True)
            continue
        nc = netCDF4.Dataset(fp)
        u = np.array(nc.variables["u_current"][0], dtype="float32")
        v = np.array(nc.variables["v_current"][0], dtype="float32")
        lat = np.array(nc.variables["latitude"][:], dtype=float)
        lon = np.array(nc.variables["longitude"][:], dtype=float)
        nc.close()
        us.append(u)
        vs.append(v)
        print("  %s ok %s (%.0f KB)" % (ds, u.shape, os.path.getsize(fp) / 1024), flush=True)

    if not us:
        sys.exit("没有取到任何快照")

    U = np.nanmean(np.stack(us), axis=0)
    V = np.nanmean(np.stack(vs), axis=0)
    if lat[0] > lat[-1]:
        lat, U, V = lat[::-1], U[::-1, :], V[::-1, :]
    if lon[0] > lon[-1]:
        lon, U, V = lon[::-1], U[:, ::-1], V[:, ::-1]

    spd = np.sqrt(U ** 2 + V ** 2)
    print("平均流场：中位 %.2f m/s，最大 %.2f m/s" % (np.nanmedian(spd), np.nanmax(spd)), flush=True)

    # ── 沿路径积分 ──
    import re
    txt = open(os.path.join(ROOT, "data.js"), encoding="utf-8").read()
    block = txt.split("OP.ROUTES = {")[1].split("\n};")[0]
    routes = {}
    for m in re.finditer(r"(\w+)\s*:\s*\[(.*?)\]\s*(?:,|\n)", block, re.S):
        name, body = m.group(1), m.group(2)
        pts = re.findall(r"\[([-\d.]+),([-\d.]+),([-\d.]+)\]", body)
        if len(pts) > 3:
            routes[name] = [(float(a), float(b), float(c)) for a, b, c in pts]

    def interp(f, la, lo):
        if not (lat[0] <= la <= lat[-1] and lon[0] <= lo <= lon[-1]):
            return np.nan
        fi = (la - lat[0]) / (lat[1] - lat[0])
        fj = (lo - lon[0]) / (lon[1] - lon[0])
        i0 = int(np.clip(fi, 0, len(lat) - 1.001))
        j0 = int(np.clip(fj, 0, len(lon) - 1.001))
        ti, tj = fi - i0, fj - j0
        return (f[i0, j0] * (1 - ti) * (1 - tj) + f[i0 + 1, j0] * ti * (1 - tj) +
                f[i0, j0 + 1] * (1 - ti) * tj + f[i0 + 1, j0 + 1] * ti * tj)

    out_routes = {}
    print("\n路径积分（实测季节平均流）vs 文献锚点：", flush=True)
    for name, pts in routes.items():
        T = 0.0
        good = 0
        for a, b in zip(pts[:-1], pts[1:]):
            (x0, y0), (x1, y1) = (a[0], a[1]), (b[0], b[1])
            dx = (x1 - x0) * 111320 * np.cos(np.radians((y0 + y1) / 2))
            dy = (y1 - y0) * 110540
            L = np.hypot(dx, dy)
            if L < 1e3:
                continue
            tx, ty = dx / L, dy / L
            n = max(int(L / 20000), 1)
            vsum = 0.0
            for k in range(n):
                t = (k + 0.5) / n
                la = y0 + (y1 - y0) * t
                lo = x0 + (x1 - x0) * t
                uu, vv = interp(U, la, lo), interp(V, la, lo)
                if not (np.isfinite(uu) and np.isfinite(vv)):
                    continue
                # 沿路径方向的分量（反向或停滞时给下限）
                vsum += max(uu * tx + vv * ty, 0.02)
            if vsum > 0:
                T += L / (vsum / n) / 86400.0
                good += 1
        out_routes[name] = {"days": round(T, 0), "segs": good,
                            "anchor": pts[-1][2] if len(pts[-1]) > 2 else None}
        print("  %-9s 积分 %5.0f 天   标定 %4.0f 天   段数 %d"
              % (name, T, pts[-1][2], good), flush=True)

    def enc(a):
        q = np.where(np.isnan(a), NAN, np.clip(np.round(a / SCALE), -32767, 32767)).astype("<i2")
        return base64.b64encode(q.tobytes()).decode("ascii")

    payload = {
        "nx": int(U.shape[1]), "ny": int(U.shape[0]),
        "lon0": round(float(lon[0]), 3), "lon1": round(float(lon[-1]), 3),
        "lat0": round(float(lat[0]), 3), "lat1": round(float(lat[-1]), 3),
        "samples": len(us), "span": [dates[0], dates[-1]],
        "source": "NOAA CoastWatch · Blended NRT Surface Currents（月度快照平均）",
        "scale": SCALE, "nan": NAN,
        "routes": out_routes,
        "u": enc(U), "v": enc(V),
    }
    fp = os.path.join(ROOT, "meanflow.js")
    with open(fp, "w", encoding="utf-8") as f:
        f.write("/* 自动生成，勿手改。tools/fetch_mean_flow.py\n"
                "   %d 个月度实测快照的平均表层流，用于标定/校验抵达时间 */\n"
                "window.OP = window.OP || {};\nOP.MEANFLOW = %s;\n"
                % (len(us), json.dumps(payload, ensure_ascii=False)))
    print("\n已写入 %s（%.0f KB）" % (fp, os.path.getsize(fp) / 1024))


if __name__ == "__main__":
    main()
