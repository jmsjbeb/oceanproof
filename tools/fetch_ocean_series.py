#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_ocean_series.py — 下载 2023-08 至今的**日频表层流场时间序列**（用于粒子追踪）。

与 fetch_currents.py 的区别
--------------------------
fetch_currents.py 只取**一天**，用于地图上的流场可视化。
本脚本取**整段历史**，用于在实测流场上做粒子追踪，从而把"抵达时间"从
"路径投影 + 文献标定"升级为"实测流场积分"。

数据源
------
NOAA CoastWatch ERDDAP `noaacwBLENDEDNRTcurrentsDaily`
- 0.25° 日频，2015-01-01 至今
- 卫星高度计 + 漂流浮标 + 模式融合的表层流，无需账号

工程约束（都是踩过的坑）
------------------------
1. 三个维度的方括号必须 %5B/%5D 编码，圆括号保持原样，否则 500
2. ERDDAP 单次响应超过约 160 KB 会被**截断**（不是报错，是静默断流），
   所以按时间窗切片，失败自动对半缩小窗口
3. 输出用 npz 压缩，NaN 保留（陆地/无观测），追踪时按"原地停留"处理

用法
----
    python tools/fetch_ocean_series.py                 # 2023-08-24 至今
    python tools/fetch_ocean_series.py --from 2023-08-24 --to 2026-10-18
    python tools/fetch_ocean_series.py --stride 4      # 1° 粗网格（更快）
"""

import argparse
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta

import numpy as np

BASE = "https://coastwatch.noaa.gov/erddap/griddap/noaacwBLENDEDNRTcurrentsDaily"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "ocean")

# 追踪区：福岛在东端，北美西岸在 180 以东，这里覆盖到 180
LON0, LON1 = 100.0, 180.0
LAT0, LAT1 = 50.0, 5.0


def url_for(d0, d1, stride):
    t = "%5B({}):1:({})%5D".format(d0, d1)
    y = "%5B({}):{}:({})%5D".format(LAT1, stride, LAT0)
    x = "%5B({}):{}:({})%5D".format(LON0, stride, LON1)
    return (BASE + ".nc?u_current{}{}{},v_current{}{}{}"
            .format(t, y, x, t, y, x))


def grab(url, timeout=240):
    req = urllib.request.Request(url, headers={"User-Agent": "OceanProof/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse(blob, tmp=".chunk.nc"):
    """把 netCDF 字节流解析成 u/v/lat/lon/time（缺 netCDF4 时退化为报错）。"""
    import netCDF4
    with open(tmp, "wb") as f:
        f.write(blob)
    ds = netCDF4.Dataset(tmp)
    try:
        u = np.array(ds.variables["u_current"][:], dtype="float32")
        v = np.array(ds.variables["v_current"][:], dtype="float32")
        lat = np.array(ds.variables["latitude"][:], dtype="float64")
        lon = np.array(ds.variables["longitude"][:], dtype="float64")
        tv = ds.variables["time"]
        t = netCDF4.num2date(tv[:], tv.units, only_use_cftime_datetimes=False)
    finally:
        ds.close()
    return u, v, lat, lon, t


def fetch_window(d0, d1, stride, tries=4):
    """取 [d0, d1]；若被截断则把窗口对半，返回若干块。"""
    span = (d1 - d0).days + 1
    try:
        blob = grab(url_for(d0.isoformat(), d1.isoformat(), stride))
        if len(blob) < 2000:                      # 太小，几乎肯定是错误页
            raise IOError("响应过小 %d B" % len(blob))
        u, v, lat, lon, t = parse(blob)
        if len(t) != span:
            raise IOError("天数不符 %d != %d（疑似截断）" % (len(t), span))
        return [(d0, d1, u, v, lat, lon, t)]
    except Exception as e:                        # noqa: BLE001
        if span == 1 or tries <= 0:
            print("    !! %s→%s 放弃：%s" % (d0, d1, type(e).__name__), flush=True)
            return []
        mid = d0 + timedelta(days=span // 2 - 1)
        print("    窗口 %s→%s 失败(%s)，拆成两半" % (d0, d1, type(e).__name__), flush=True)
        return (fetch_window(d0, mid, stride, tries - 1) +
                fetch_window(mid + timedelta(days=1), d1, stride, tries - 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d0", default="2023-08-24")
    ap.add_argument("--to", dest="d1", default=None)
    ap.add_argument("--stride", type=int, default=4, help="网格步长，4 = 1°")
    ap.add_argument("--chunk", type=int, default=24, help="每个请求的天数上限")
    args = ap.parse_args()

    os.makedirs(CACHE, exist_ok=True)
    d0 = datetime.strptime(args.d0, "%Y-%m-%d").date()
    d1 = (datetime.strptime(args.d1, "%Y-%m-%d").date() if args.d1
          else date.today() - timedelta(days=1))
    if d1 > date(2026, 10, 17):
        d1 = date(2026, 10, 17)

    print("区间 %s → %s（%d 天），步长 %d（约 %.2f°）"
          % (d0, d1, (d1 - d0).days + 1, args.stride, 0.25 * args.stride), flush=True)

    chunks, cur = [], d0
    t_start = time.time()
    while cur <= d1:
        end = min(cur + timedelta(days=args.chunk - 1), d1)
        stamp = "%s_%s" % (cur.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
        fp = os.path.join(CACHE, stamp + ".npz")
        if os.path.exists(fp):
            cur = end + timedelta(days=1)
            continue
        tt = time.time()
        got = fetch_window(cur, end, args.stride)
        if got:
            us = np.concatenate([g[2] for g in got], axis=0)
            vs = np.concatenate([g[3] for g in got], axis=0)
            ts = np.concatenate([np.asarray(g[6]) for g in got], axis=0)
            np.savez_compressed(fp, u=us, v=vs, lat=got[0][4], lon=got[0][5],
                                time=ts.astype("datetime64[D]").astype(str))
            chunks.append(len(ts))
            done = sum(chunks)
            el = time.time() - t_start
            eta = el / max(done, 1) * ((d1 - d0).days + 1 - done)
            print("  %s  %d 天  %.0fs  累计 %d/%d  ETA %.0f min"
                  % (stamp, len(ts), time.time() - tt, done,
                     (d1 - d0).days + 1, eta / 60), flush=True)
        cur = end + timedelta(days=1)

    print("完成：%d 个文件，%d 天，用时 %.0f min"
          % (len(os.listdir(CACHE)), sum(chunks), (time.time() - t_start) / 60))


if __name__ == "__main__":
    sys.exit(main())
