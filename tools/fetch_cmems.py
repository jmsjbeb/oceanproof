#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
海证 OceanProof — CMEMS 表层流取数脚本

把 Copernicus Marine 的真实表层流（1/12°）重采样到产品网格，
输出 currents.js，供 field.js 直接替换参数化流场。

用法：
    pip install copernicusmarine xarray netCDF4
    copernicusmarine login                # 免费账号，只需一次
    python tools/fetch_cmems.py           # 默认取 2026-10-01 的分析场
    python tools/fetch_cmems.py --date 2026-10-15 --step 0.5
    python tools/fetch_cmems.py --check   # 只列出可用数据集，不下载

注意：本脚本未在作者环境实跑（无 CMEMS 账号）。首次运行请先 --check
确认 dataset_id 与变量名，再正式取数。

许可：Generated using Copernicus Marine Service information.
"""

import argparse
import os
import sys

import numpy as np

# 产品网格：与 field.js 中 LON0/LON1/LAT0/LAT1 保持一致
LON0, LON1 = 100.0, 170.0
LAT0, LAT1 = 45.0, 15.0          # LAT0 为北界

DATASETS = {
    "anfc": "cmems_mod_glo_phy_anfc_0.083deg_P1D-m",   # 分析预报（近实时）
    "my":   "cmems_mod_glo_phy_my_0.083deg_P1D-m",     # 再分析（1993 至今）
}


def check():
    """列出可用数据集，帮助确认 dataset_id。"""
    import copernicusmarine
    print("正在查询 CMEMS 目录……")
    try:
        df = copernicusmarine.describe(contains=["glo", "phy"])
        print(df[["dataset_id", "product_id"]] if hasattr(df, "columns") else df)
    except Exception as e:
        print("describe() 失败：", e)
        print("可改用命令行：copernicusmarine describe --contains glo phy")


def fetch(dataset_id, date, depth_max=1.0):
    """下载子集到本地 NetCDF。"""
    import copernicusmarine

    out = "cmems_subset.nc"
    if os.path.exists(out):
        os.remove(out)

    print(f"下载 {dataset_id}  {date}  …")
    copernicusmarine.subset(
        dataset_id=dataset_id,
        variables=["uo", "vo"],
        minimum_longitude=LON0,
        maximum_longitude=LON1,
        minimum_latitude=LAT1,
        maximum_latitude=LAT0,
        minimum_depth=0,
        maximum_depth=depth_max,
        start_datetime=f"{date}T00:00:00",
        end_datetime=f"{date}T23:59:59",
        output_filename=out,
        overwrite=True,
    )
    return out


def resample(field, lats, lons, out_lat_asc, out_lon):
    """双线性重采样到目标网格。field: (nlat, nlon)"""
    tmp = np.full((field.shape[0], out_lon.size), np.nan)
    for i in range(field.shape[0]):
        tmp[i] = np.interp(out_lon, lons, field[i], left=np.nan, right=np.nan)

    out = np.full((out_lat_asc.size, out_lon.size), np.nan)
    for j in range(out_lon.size):
        out[:, j] = np.interp(out_lat_asc, lats, tmp[:, j], left=np.nan, right=np.nan)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="2026-10-01", help="YYYY-MM-DD")
    ap.add_argument("--step", type=float, default=0.25, help="输出网格步长（度）")
    ap.add_argument("--kind", default="anfc", choices=list(DATASETS), help="anfc=近实时 / my=再分析")
    ap.add_argument("--out", default="currents.js")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    if args.check:
        check()
        return

    import xarray as xr

    nc = fetch(DATASETS[args.kind], args.date)
    ds = xr.open_dataset(nc)

    var_names = list(ds.data_vars)
    print("变量：", var_names)

    u = ds["uo"]
    v = ds["vo"]
    if "time" in u.dims:
        u = u.isel(time=0)
        v = v.isel(time=0)
    if "depth" in u.dims:
        u = u.isel(depth=0)
        v = v.isel(depth=0)

    lat_name = "latitude" if "latitude" in u.dims else "lat"
    lon_name = "longitude" if "longitude" in u.dims else "lon"

    lats = np.asarray(u[lat_name].values, dtype=float)
    lons = np.asarray(u[lon_name].values, dtype=float)

    # 保证 lats 升序，np.interp 要求
    if lats[0] > lats[-1]:
        lats = lats[::-1]
        u = u.isel({lat_name: slice(None, None, -1)})
        v = v.isel({lat_name: slice(None, None, -1)})

    n_lon = int(round((LON1 - LON0) / args.step)) + 1
    n_lat = int(round((LAT0 - LAT1) / args.step)) + 1
    out_lon = np.linspace(LON0, LON1, n_lon)
    out_lat_asc = np.linspace(LAT1, LAT0, n_lat)

    U = resample(np.asarray(u.values, dtype=float), lats, lons, out_lat_asc, out_lon)
    V = resample(np.asarray(v.values, dtype=float), lats, lons, out_lat_asc, out_lon)

    # 翻转为北在上（与 field.js 的行序一致）
    U = U[::-1]
    V = V[::-1]

    # 陆地/缺测置 0，与 field.js 的掩膜逻辑配合
    U = np.nan_to_num(U, nan=0.0, posinf=0.0, neginf=0.0)
    V = np.nan_to_num(V, nan=0.0, posinf=0.0, neginf=0.0)

    spd = np.sqrt(U ** 2 + V ** 2)
    print(f"网格 {n_lon}×{n_lat}，流速范围 {spd.min():.3f}–{spd.max():.3f} m/s，"
          f"非零格点 {(spd > 1e-6).sum()}")

    def ser(a):
        return "[" + ",".join(f"{x:.2f}" for x in a.ravel()) + "]"

    js = (
        "/* Generated using Copernicus Marine Service information.\n"
        f"   dataset={DATASETS[args.kind]}  date={args.date}  step={args.step}°\n"
        "   由 tools/fetch_cmems.py 生成，请勿手改。 */\n"
        "window.OP = window.OP || {};\n"
        "OP.CURRENTS_DATA = {\n"
        f"  nx:{n_lon}, ny:{n_lat}, lon0:{LON0}, lon1:{LON1}, lat0:{LAT0}, lat1:{LAT1},\n"
        f"  u:{ser(U)},\n"
        f"  v:{ser(V)}\n"
        "};\n"
    )

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)

    size = os.path.getsize(args.out) / 1024
    print(f"已写出 {args.out}（{size:.0f} KB）")
    print("接入：在 index.html 的 field.js 之前引入 <script src=\"currents.js\"></script>，")
    print("      并在 field.js 的 build() 开头判断 OP.CURRENTS_DATA 是否可用（见 数据源清单.md）。")


if __name__ == "__main__":
    try:
        main()
    except ImportError as e:
        print("缺少依赖：", e)
        print("请先执行： pip install copernicusmarine xarray netCDF4")
        sys.exit(1)
