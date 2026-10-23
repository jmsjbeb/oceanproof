#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_atmos.py — 下载**实测再分析**风场与降水率，供大气输送粒子追踪使用。

数据源
------
NOAA PSL / NCEP-NCAR Reanalysis 1，THREDDS OPeNDAP，**无需注册**：
  https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/

- 风场：`pressure/uwnd.YYYY.nc`、`vwnd.YYYY.nc`，取 **850 hPa**（水汽输送引导层）
  2.5°×2.5°，6 小时一次
- 降水：`surface_gauss/prate.sfc.gauss.YYYY.nc`，地面降水率 kg m⁻² s⁻¹
  1.9° 高斯网格，6 小时一次

为什么用 850 hPa 而不是 10 m 风
-------------------------------
10 m 风受地形摩擦与海陆差异强烈调制，用来推水汽轨迹会系统性偏慢；
850 hPa 约 1500 m，是天气尺度水汽输送的常用引导层（HYSPLIT 等模式也常取此层）。

输出
----
`tools/cache/atmos/atmos_YYYY.npz`
  uw, vw : (time, lat, lon) 850 hPa 风 m/s
  pr     : (time, glat, glon) 降水率 kg m⁻² s⁻¹
  t      : (time,) 字符串日期时间
"""

import os
import sys
import time

import numpy as np

try:
    import netCDF4
except ImportError:
    sys.exit("需要 netCDF4：pip install netCDF4")

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "atmos")
ROOT = "https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis"

LON_A, LON_B = 90.0, 200.0      # 覆盖华东、华北、西南与西北太平洋
LAT_A, LAT_B = 0.0, 60.0
LEVEL = float(os.environ.get("LEVEL", "850"))


def idx_range(arr, lo, hi):
    a = np.asarray(arr, dtype=float)
    m = np.where((a >= lo) & (a <= hi))[0]
    return int(m[0]), int(m[-1])


def fetch_year(year):
    fp = os.path.join(CACHE, "atmos_%d_%d.npz" % (year, int(LEVEL)))
    if os.path.exists(fp):
        print("  已存在 %s，跳过" % os.path.basename(fp), flush=True)
        return

    t0 = time.time()
    print("  打开 %d 年风场（%d hPa）…" % (year, LEVEL), flush=True)
    du = netCDF4.Dataset("%s/pressure/uwnd.%d.nc" % (ROOT, year))
    dv = netCDF4.Dataset("%s/pressure/vwnd.%d.nc" % (ROOT, year))

    lev = np.asarray(du.variables["level"][:], dtype=float)
    li = int(np.where(lev == LEVEL)[0][0])
    lat = np.asarray(du.variables["lat"][:], dtype=float)
    lon = np.asarray(du.variables["lon"][:], dtype=float)
    i0, i1 = idx_range(lat, LAT_A, LAT_B)
    j0, j1 = idx_range(lon, LON_A, LON_B)
    n = len(du.variables["time"])
    print("    level idx %d, lat %d..%d, lon %d..%d, t=%d"
          % (li, i0, i1, j0, j1, n), flush=True)

    uw = np.asarray(du.variables["uwnd"][0:n, li, i0:i1 + 1, j0:j1 + 1], dtype="float32")
    print("    uwnd %.1fs %s" % (time.time() - t0, uw.shape), flush=True)
    vw = np.asarray(dv.variables["vwnd"][0:n, li, i0:i1 + 1, j0:j1 + 1], dtype="float32")
    tv = du.variables["time"]
    tt = netCDF4.num2date(tv[:], tv.units, only_use_cftime_datetimes=False)
    du.close()
    dv.close()

    print("  打开 %d 年降水…" % year, flush=True)
    dp = netCDF4.Dataset("%s/surface_gauss/prate.sfc.gauss.%d.nc" % (ROOT, year))
    glat = np.asarray(dp.variables["lat"][:], dtype=float)
    glon = np.asarray(dp.variables["lon"][:], dtype=float)
    gi0, gi1 = idx_range(glat, LAT_A, LAT_B)
    gj0, gj1 = idx_range(glon, LON_A, LON_B)
    pr = np.asarray(dp.variables["prate"][0:n, gi0:gi1 + 1, gj0:gj1 + 1], dtype="float32")
    dp.close()
    print("    prate %s" % (pr.shape,), flush=True)

    os.makedirs(CACHE, exist_ok=True)
    np.savez_compressed(
        fp, uw=uw, vw=vw, pr=pr,
        lat=lat[i0:i1 + 1], lon=lon[j0:j1 + 1],
        glat=glat[gi0:gi1 + 1], glon=glon[gj0:gj1 + 1],
        t=np.array([str(x)[:19] for x in tt]),
    )
    print("  写出 %s（%.1f MB，%.0fs）"
          % (os.path.basename(fp), os.path.getsize(fp) / 1e6, time.time() - t0), flush=True)


def main():
    years = [int(a) for a in sys.argv[1:]] or [2023, 2024]
    os.makedirs(CACHE, exist_ok=True)
    for y in years:
        fetch_year(y)
    print("完成")


if __name__ == "__main__":
    main()
