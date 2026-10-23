# -*- coding: utf-8 -*-
"""refresh.py — 一条命令把数据刷到最新。

做的事（每步失败都不影响下一步，抓不到就保留上一份）：
  1. fetch_currents.py   NOAA 日频表层流场 → currents.js
  2. fetch_prices.py     农业农村部批发价   → prices.js
  3. build_manifest.py   从数据文件里读出日期 → manifest-data.js
  4. inline_single.py    重新内联单文件离线版
  5. build_miniapp_data.py  重新生成小程序数据层（miniapp/data/）

不做的：大气追踪（60 万粒子，跑一次几十分钟，且源是 2023-08→2024-10 的历史场）、
抵达天数重算（季节级任务，用 fetch_mean_flow.py）。

用法：
    python tools/refresh.py                # 全量
    python tools/refresh.py --skip-fetch   # 只重算清单 + 单文件
    python tools/refresh.py --only prices  # 只刷价格
"""
import argparse
import io
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, "tools")


def run(name, script, args=()):
    path = os.path.join(TOOLS, script)
    if not os.path.exists(path):
        return name, "缺脚本", 0.0
    t0 = time.time()
    r = subprocess.run([sys.executable, path] + list(args),
                       cwd=ROOT, capture_output=True, text=True)
    dt = time.time() - t0
    if r.returncode != 0:
        tail = (r.stderr or r.stdout or "").strip().splitlines()[-3:]
        print("  失败：", " / ".join(tail))
        return name, "失败", dt
    for line in (r.stdout or "").strip().splitlines()[:3]:
        print("  " + line)
    return name, "OK", dt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-fetch", action="store_true", help="跳过联网抓取")
    ap.add_argument("--only", choices=["currents", "prices"], help="只刷其中一项")
    a = ap.parse_args()

    print("工作目录", ROOT)
    results = []

    if not a.skip_fetch:
        if a.only in (None, "currents"):
            print("\n[1] 表层流场")
            results.append(run("流场", "fetch_currents.py"))
        if a.only in (None, "prices"):
            print("\n[2] 批发价")
            results.append(run("价格", "fetch_prices.py"))

    print("\n[3] 数据时效清单")
    results.append(run("清单", "build_manifest.py"))

    print("\n[4] 单文件离线版")
    results.append(run("单文件", "inline_single.py"))

    print("\n[5] 小程序数据层")
    results.append(run("小程序", "build_miniapp_data.py"))

    print("\n" + "=" * 46)
    for name, st, dt in results:
        print("  %-6s %-4s %5.1fs" % (name, st, dt))

    bad = [r for r in results if r[1] != "OK"]
    if bad:
        print("\n有 %d 步没成功，站点仍可运行（用的是上一份数据）。" % len(bad))
    else:
        print("\n全部成功。接下来：git add -A && git commit && git push")


if __name__ == "__main__":
    main()
