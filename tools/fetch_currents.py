#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_currents.py — 下载真实海洋表层流场，生成 currents.js。

数据源
------
NOAA CoastWatch ERDDAP：`noaacwBLENDEDNRTcurrentsDaily`
  https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily
- 全球 0.25° 日频表层流（u/v，单位 m/s），近实时（NRT）
- **无需注册、无需 API key**，直接 HTTP 取数
- 覆盖范围 lat −89.875..89.875，lon −179.875..179.875

为什么用它而不是 CMEMS
----------------------
CMEMS 精度更高（1/12°），但需要 marine.copernicus.eu 的独立账号；
CoastWatch 的这套混合流场是开放接口，当天就能跑通。
两者都接得进 field.js，切换只需改这个脚本里的 URL。

输出格式
--------
`OP.CURRENTS_DATA = { nx, ny, lon0, lon1, lat0, lat1, date, source, u, v }`
u / v 为 **base64 编码的 Int16 小端数组**（缩放 0.01，即 cm/s），
NaN 用 −32768 表示。这样 3.4 万个格点只占约 180 KB，比 JSON 浮点数组小 4 倍。

用法
----
    python tools/fetch_currents.py
    python tools/fetch_currents.py --date 2026-10-10
"""

import argparse
import base64
import json
import os
import struct
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

import numpy as np

try:
    import netCDF4  # noqa: F401
except ImportError:
    sys.exit("需要 netCDF4：pip install netCDF4")

BASE = "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily"
# 与 field.js 一致的研究区（LAT0 为北界，LAT1 为南界）
LON0, LON1 = 100.0, 170.0
LAT0, LAT1 = 45.0, 15.0
NAN_SENTINEL = -32768
SCALE = 0.01  # m/s -> cm/s


def build_url(date=None, stride=1):
    """三个维度索引的方括号都必须百分号编码（否则 500），圆括号保持原样。"""
    t = "%5B({})%5D".format(date if date else "last")
    y = "%5B({}):{}:({})%5D".format(LAT1, stride, LAT0)
    x = "%5B({}):{}:({})%5D".format(LON0, stride, LON1)
    return BASE + ".nc?u_current{}{}{},v_current{}{}{}".format(t, y, x, t, y, x)


def download(url, dest, timeout=180, retries=3):
    """ERDDAP 对大请求会中途断流（IncompleteRead），所以按纬度分带取。"""
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "OceanProof/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
                f.write(r.read())
            return os.path.getsize(dest)
        except Exception as e:          # noqa: BLE001
            last = e
            print("    重试 %d/%d：%s" % (i + 1, retries, type(e).__name__), flush=True)
    raise last


def fetch_band(la0, la1, date, dest):
    """取一个纬度带。la0 < la1。"""
    t = "%5B({})%5D".format(date if date else "last")
    y = "%5B({}):1:({})%5D".format(la0, la1)
    x = "%5B({}):1:({})%5D".format(LON0, LON1)
    url = BASE + ".nc?u_current{}{}{},v_current{}{}{}".format(t, y, x, t, y, x)
    n = download(url, dest)
    print("    纬度带 %g–%gN -> %.0f KB" % (la0, la1, n / 1024), flush=True)
    return dest


def encode(arr):
    """float32 网格 -> base64(Int16 小端)，NaN 记为 -32768。"""
    q = np.where(np.isnan(arr), NAN_SENTINEL, np.clip(np.round(arr / SCALE), -32767, 32767))
    q = q.astype("<i2")
    return base64.b64encode(q.tobytes()).decode("ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=None, help="YYYY-MM-DD，缺省取最新一天")
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "currents.js"))
    ap.add_argument("--keep", action="store_true", help="保留下载的 .nc")
    args = ap.parse_args()

    tmpdir = os.path.dirname(os.path.abspath(args.out))
    bands = [(15.0, 25.0), (25.0, 35.0), (35.0, 45.0)]
    parts = []
    import xarray as xr
    for i, (a, b) in enumerate(bands):
        p = os.path.join(tmpdir, ".cur_band%d.nc" % i)
        fetch_band(a, b, args.date, p)
        parts.append(xr.open_dataset(p))

    def cat(name):
        arrs = []
        for i, d in enumerate(parts):
            v = d[name]
            v = v.isel(time=0) if "time" in v.dims else v
            arrs.append(v.squeeze())
        # 相邻带有重叠的边界纬度，去掉重复行
        out = arrs[0]
        for nxt in arrs[1:]:
            out = xr.concat([out, nxt.sel(latitude=slice(None))], dim="latitude")
        latv = out["latitude"].values
        _, keep = np.unique(np.round(latv, 4), return_index=True)
        return out.isel(latitude=np.sort(keep))

    u = cat("u_current")
    v = cat("v_current")
    lat = np.asarray(u["latitude"].values, dtype=float)
    lon = np.asarray(u["longitude"].values, dtype=float)

    date = args.date or "latest"
    try:
        tv = parts[0]["time"].values
        date = str(np.asarray(tv).ravel()[0])[:10]
    except Exception:  # noqa: BLE001
        pass
    if lat[0] > lat[-1]:  # 统一成由南向北
        lat, u, v = lat[::-1], u[::-1, :], v[::-1, :]
    if lon[0] > lon[-1]:
        lon, u, v = lon[::-1], u[:, ::-1], v[:, ::-1]

    ua = np.asarray(u.values, dtype=float)
    va = np.asarray(v.values, dtype=float)

    valid = np.isfinite(ua) & np.isfinite(va)
    spd = np.sqrt(np.where(valid, ua, 0) ** 2 + np.where(valid, va, 0) ** 2)
    print("  网格 %d×%d  有效格点 %.1f%%" % (ua.shape[1], ua.shape[0], 100 * valid.mean()))
    if valid.any():
        print("  流速 中位 %.2f m/s  最大 %.2f m/s" % (np.median(spd[valid]), spd[valid].max()))

    payload = {
        "nx": int(ua.shape[1]), "ny": int(ua.shape[0]),
        "lon0": round(float(lon[0]), 4), "lon1": round(float(lon[-1]), 4),
        "lat0": round(float(lat[0]), 4), "lat1": round(float(lat[-1]), 4),
        "date": date,
        "source": "NOAA CoastWatch · Blended NRT Surface Currents",
        "sourceUrl": "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily",
        "unit": "m/s", "scale": SCALE, "nan": NAN_SENTINEL,
        "fetchedAt": datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%dT%H:%M+08:00"),
        "u": encode(ua), "v": encode(va),
    }

    js = ("/* 自动生成，勿手改。由 tools/fetch_currents.py 抓取。\n"
          "   源：%s（%s）\n"
          "   格式：u/v 为 base64(Int16 小端)，缩放 %.2f，NaN=%d */\n"
          "window.OP = window.OP || {};\nOP.CURRENTS_DATA = %s;\n"
          % (payload["source"], payload["sourceUrl"], SCALE, NAN_SENTINEL,
             json.dumps(payload, ensure_ascii=False)))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)
    print("已写入 %s（%.0f KB）" % (args.out, os.path.getsize(args.out) / 1024))
    print("日期 %s | %d×%d | 覆盖 %.1f–%.1fE / %.1f–%.1fN"
          % (date, payload["nx"], payload["ny"], payload["lon0"], payload["lon1"],
             payload["lat0"], payload["lat1"]))

    if not args.keep:
        for i in range(len(bands)):
            p = os.path.join(tmpdir, ".cur_band%d.nc" % i)
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass  # 某些沙箱会拦截删除，中间文件留着无害


if __name__ == "__main__":
    main()
