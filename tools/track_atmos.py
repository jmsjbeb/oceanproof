#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
track_atmos.py — 用**实测再分析风场**做大气水汽粒子追踪，算出
"某地降水中来自福岛邻近海域水汽的比例" f_ocean 的空间分布。

为什么需要这一步
----------------
原先前端用的是一个径向衰减的经验式：
    f_ocean = clamp(0.10 · exp(−d / 900 km), 0.03, 0.10)
这个式子没有任何观测支撑，只是"看起来合理"。本脚本把它换成：
在 NCEP/NCAR 再分析 850 hPa 风场里释放粒子、按实测降水率做湿沉降、
统计每个格点接收到的"源区水汽"份额。

物理设定
--------
- 源区：福岛外海 137–147°E / 31–40°N（含黑潮延伸体西端）
- 输送层：850 hPa（约 1500 m），天气尺度水汽引导层
- 湿沉降：τ_wet = W / P，W = 25 kg/m²（可降水量），P 为实测降水率
  6 小时内被冲刷的概率 = 1 − exp(−Δt/τ_wet)
- 混合损失：与未污染水汽混合，e 折 9 天，损失后不再计入（成为本底）
- 水平扩散：随机游走，K = 5×10⁴ m²/s（天气尺度典型值）

归一化
------
源区蒸发通量取 E = 1.2 m/yr（全球海洋平均量级），
    f = D · m_p / (P_cell · A_cell · T)
其中 m_p = E·A_src·T / N_total 是每个粒子代表的水质量。

用法
----
    python tools/track_atmos.py                 # 2023-08-24 → 2024-10-31
    python tools/track_atmos.py --n 80000
"""

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "atmos")
ROOT = os.path.dirname(HERE)

SRC_LON = (137.0, 147.0)
SRC_LAT = (31.0, 40.0)
DT = 6 * 3600.0
MAX_AGE = 12 * 86400.0
W_PW = 25.0
TAU_MIX = 9 * 86400.0
K_DIFF = 5.0e4
E_EVAP = 1.2 / (365 * 86400)      # m/s
R_EARTH = 6371000.0

# 输出网格
G_LON = (95.0, 180.0)
G_LAT = (5.0, 55.0)
G_RES = 0.5


def load(level=850):
    parts = []
    for y in (2023, 2024):
        fp = os.path.join(CACHE, "atmos_%d_%d.npz" % (y, level))
        if not os.path.exists(fp):
            sys.exit("缺少 %s，先跑 tools/fetch_atmos.py" % fp)
        parts.append(np.load(fp, allow_pickle=False))
    cat = {}
    for k in ("uw", "vw", "pr", "t"):
        cat[k] = np.concatenate([p[k] for p in parts], axis=0)
    cat["lat"] = parts[0]["lat"]
    cat["lon"] = parts[0]["lon"]
    cat["glat"] = parts[0]["glat"]
    cat["glon"] = parts[0]["glon"]
    return cat


def bilinear(field, lat, lon, la, lo):
    """规则网格双线性插值；越界返回 NaN。lat 降序，lon 升序。"""
    la = np.asarray(la, dtype=float)
    lo = np.asarray(lo, dtype=float)
    out = np.full(la.shape, np.nan, dtype=float)
    ok = (la >= lat[-1]) & (la <= lat[0]) & (lo >= lon[0]) & (lo <= lon[-1])
    if not ok.any():
        return out
    la, lo = la[ok], lo[ok]
    fi = np.clip((lat[0] - la) / (lat[0] - lat[1]), 0, len(lat) - 1.001)
    fj = np.clip((lo - lon[0]) / (lon[1] - lon[0]), 0, len(lon) - 1.001)
    i0 = fi.astype(int)
    j0 = fj.astype(int)
    ti = fi - i0
    tj = fj - j0
    v = (field[i0, j0] * (1 - ti) * (1 - tj) + field[i0 + 1, j0] * ti * (1 - tj) +
         field[i0, j0 + 1] * (1 - ti) * tj + field[i0 + 1, j0 + 1] * ti * tj)
    out[ok] = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=60000)
    ap.add_argument("--t0", default="2023-08-24")
    ap.add_argument("--t1", default="2024-10-31")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--level", type=int, default=850)
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    D = load(args.level)
    times = D["t"]
    mask = (times >= args.t0) & (times <= args.t1)
    ti = np.where(mask)[0]
    if len(ti) < 10:
        sys.exit("时间区间内没有数据")
    print("风场时段 %s → %s，可用 %d 个 6 小时步" % (times[ti[0]], times[ti[-1]], len(ti)), flush=True)

    lat, lon = D["lat"], D["lon"]
    glat, glon = D["glat"], D["glon"]

    # ── 粒子释放：在时段内均匀抽样释放时刻，源区按面积均匀撒点 ──
    n_rel = len(ti) - int(MAX_AGE / DT) - 1
    per = int(np.ceil(args.n / max(n_rel, 1)))
    lat_r = np.radians(np.linspace(SRC_LAT[0], SRC_LAT[1], 200))
    wgt = np.cos(lat_r)
    wgt = wgt / wgt.sum()

    px, py, page, alive = [], [], [], []
    for k in range(n_rel):
        # 释放时刻 k 的粒子在后续步里推进；这里只登记起点与"已走步数"
        la = rng.choice(np.linspace(SRC_LAT[0], SRC_LAT[1], 200), size=per, p=wgt)
        lo = rng.uniform(SRC_LON[0], SRC_LON[1], size=per)
        px.append(lo)
        py.append(la)
        page.append(np.zeros(per, dtype=int))

    # 为了向量化，按"释放批次"逐批推进
    n_total = 0
    dep_la, dep_lo = [], []
    for k in range(n_rel):
        lo = px[k].copy()
        la = py[k].copy()
        step = np.zeros(len(lo), dtype=bool)  # 存活标记（True=活着）
        step[:] = True
        for s in range(int(MAX_AGE / DT)):
            idx = ti[k + s]
            if idx >= len(times):
                break
            u = bilinear(D["uw"][idx], lat, lon, la, lo)
            v = bilinear(D["vw"][idx], lat, lon, la, lo)
            pr = bilinear(D["pr"][idx], glat, glon, la, lo)

            good = step & np.isfinite(u) & np.isfinite(v)
            # 出界或落在缺测：视为离开研究区
            step &= np.isfinite(u) & np.isfinite(v)
            if not good.any():
                break

            # 平流
            dlat = v * DT / 110540.0
            dlon = u * DT / (111320.0 * np.maximum(np.cos(np.radians(la)), 0.15))
            # 扩散
            sig = np.sqrt(2 * K_DIFF * DT) / 111000.0
            la = np.where(good, la + dlat + rng.normal(0, sig, len(la)), la)
            lo = np.where(good, lo + dlon + rng.normal(0, sig, len(lo)), lo)

            # 湿沉降
            prf = np.where(np.isfinite(pr), np.maximum(pr, 0), 0.0)
            tau_w = np.where(prf > 1e-8, W_PW / np.maximum(prf, 1e-8), 1e12)
            p_wet = 1 - np.exp(-DT / np.minimum(tau_w, 1e12))
            p_mix = 1 - np.exp(-DT / TAU_MIX)
            r = rng.random(len(la))
            wet = step & (r < p_wet)
            if wet.any():
                dep_la.append(la[wet])
                dep_lo.append(lo[wet])
            step &= ~wet
            step &= rng.random(len(la)) > p_mix
            if not step.any():
                break
        n_total += len(px[k])
        if k % 200 == 0:
            print("  批次 %d/%d，累计释放 %d，已沉降 %d"
                  % (k, n_rel, n_total, sum(len(x) for x in dep_la)), flush=True)

    d_la = np.concatenate(dep_la) if dep_la else np.array([])
    d_lo = np.concatenate(dep_lo) if dep_lo else np.array([])
    print("释放 %d，沉降 %d（%.1f%%），其余混合稀释或出界"
          % (n_total, len(d_la), 100.0 * len(d_la) / max(n_total, 1)), flush=True)

    # ── 网格化 + 归一化为"降水中源区水汽占比" ──
    nlon = int(round((G_LON[1] - G_LON[0]) / G_RES))
    nlat = int(round((G_LAT[1] - G_LAT[0]) / G_RES))
    ix = np.floor((d_lo - G_LON[0]) / G_RES).astype(int)
    iy = np.floor((d_la - G_LAT[0]) / G_RES).astype(int)
    ok = (ix >= 0) & (ix < nlon) & (iy >= 0) & (iy < nlat)
    Dcnt = np.zeros((nlat, nlon), dtype=float)
    np.add.at(Dcnt, (iy[ok], ix[ok]), 1.0)

    # 平均降水率（整段时段）
    Pbar = np.zeros((nlat, nlon), dtype=float)
    cnt = np.zeros((nlat, nlon), dtype=float)
    sub = slice(ti[0], ti[-1] + 1, 8)          # 每 2 天取一次足够
    for t in range(ti[0], ti[-1] + 1, 8):
        f = bilinear(D["pr"][t], glat, glon,
                     *np.meshgrid(np.arange(G_LAT[0] + G_RES / 2, G_LAT[1], G_RES),
                                  np.arange(G_LON[0] + G_RES / 2, G_LON[1], G_RES),
                                  indexing="ij"))
        Pbar += np.nan_to_num(f)
        cnt += np.isfinite(f)
    Pbar = np.where(cnt > 0, Pbar / np.maximum(cnt, 1), 0.0)

    days = (ti[-1] - ti[0] + 1) * 6 / 24.0
    A_src = (SRC_LON[1] - SRC_LON[0]) * 111320.0 * (SRC_LAT[1] - SRC_LAT[0]) * 110540.0
    # E_EVAP 是 m/s（体积通量），乘面积得 m³/s，再乘 1000 kg/m³ 才是质量通量
    m_src = E_EVAP * A_src * days * 86400.0 * 1000.0   # 源区蒸发总水量 kg
    m_p = m_src / max(n_total, 1)                      # 每个粒子代表的水质量 kg

    # ── 平滑：0.5° 格点的原始计数太稀（多数格点 0 个粒子），
    #    用 5×5 箱式滤波同时平滑沉降数与降水率，比值才稳定 ──
    def box(a, r=2):
        k = 2 * r + 1
        p = np.pad(a, r, mode="edge")
        c = np.cumsum(np.cumsum(p, axis=0), axis=1)
        c = np.pad(c, ((1, 0), (1, 0)))
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)

    Dsm = box(Dcnt, 2)
    Psm = box(Pbar, 2)

    cell_area = (G_RES * 111320.0) * (G_RES * 110540.0)
    Pcell = Psm * days * 86400.0                   # 该格点降水总量 kg/m²
    f = np.where(Pcell > 1.0, Dsm * m_p / np.maximum(Pcell * cell_area, 1e-9), 0.0)

    land_ok = (Pbar > 1.5e-5)                      # 年降水 > ~470 mm
    print("f_ocean: 中位 %.2e  95分位 %.2e  最大 %.2e"
          % (np.median(f[land_ok]) if land_ok.any() else 0,
             np.percentile(f[land_ok], 95) if land_ok.any() else 0,
             f.max()), flush=True)

    out = {
        "lon0": G_LON[0], "lat0": G_LAT[0], "res": G_RES,
        "nx": nlon, "ny": nlat,
        "t0": times[ti[0]], "t1": times[ti[-1]],
        "source": "NCEP/NCAR Reanalysis 1 · %d hPa 风场 + 地面降水率" % args.level,
        "sourceUrl": "https://psl.noaa.gov/thredds/dodsC/Datasets/ncep.reanalysis/",
        "particles": int(n_total), "deposited": int(len(d_la)),
        "f": [[float("%.4g" % v) for v in row] for row in f],
    }
    fp = os.path.join(ROOT, "atmos_f.json")
    with open(fp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("已写入 %s（%.0f KB）" % (fp, os.path.getsize(fp) / 1024), flush=True)


if __name__ == "__main__":
    main()
