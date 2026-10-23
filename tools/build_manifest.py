# -*- coding: utf-8 -*-
"""build_manifest.py — 扫描各数据文件里写死的日期与规模，生成 manifest-data.js。

为什么要有这一步
----------------
界面上「数据截至 2026-10-18」原来是手写字符串，而流场是 10-16、价格是 10-18，
一个日期盖住三个不同时点。这个脚本把日期从数据文件里读出来，避免手写漂移。

输出：manifest-data.js -> OP.DATA_MANIFEST
用法：python tools/build_manifest.py
"""
import io
import json
import os
import re
from datetime import datetime, timezone, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "manifest-data.js")
CST = timezone(timedelta(hours=8))


def read(name):
    with io.open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


def grab(pattern, text, default=None):
    m = re.search(pattern, text)
    return m.group(1) if m else default


def main():
    cur = read("currents.js")
    pri = read("prices.js")
    atm = read("atmos_f.js")
    adm = read("admin.js")
    dat = read("data.js")

    cur_date = grab(r'"date":\s*"(\d{4}-\d{2}-\d{2})"', cur)
    pri_date = grab(r'"date":\s*"(\d{4}-\d{2}-\d{2})"', pri)
    pri_fetch = grab(r'"fetchedAt":\s*"([^"]+)"', pri)
    atm_t0 = grab(r'"t0":\s*"([^"]+)"', atm)
    atm_t1 = grab(r'"t1":\s*"([^"]+)"', atm)

    n_admin = len(re.findall(
        r'\["[^"]+",-?[\d.]+,-?[\d.]+,"(?:province|city|district)",', adm))
    rounds = grab(r"rounds:\s*(\d+)", dat, "?")
    tons = grab(r"totalTons:\s*(\d+)", dat, "?")
    n_parts = len(re.findall(r'"name":\s*"', pri))
    n_atmos = grab(r"(\d+)\s*粒子", atm, "?")

    tons_fmt = "{:,}".format(int(tons)) if tons.isdigit() else tons
    admin_fmt = "{:,}".format(n_admin)
    atmos_fmt = "{:,}".format(int(n_atmos)) if str(n_atmos).isdigit() else str(n_atmos)

    sources = [
        {"k": "currents", "short": "流场", "n": "海洋表层流场",
         "kind": "snapshot", "freq": "日频",
         "date": cur_date, "dateText": None, "value": "0.25° 日频 u/v 场",
         "tool": "tools/fetch_currents.py",
         "src": "NOAA CoastWatch · Blended NRT Surface Currents",
         "use": "溯源地图的流线与粒子推进方向"},

        {"k": "prices", "short": "价格", "n": "农产品批发价",
         "kind": "snapshot", "freq": "日频（工作日）",
         "date": pri_date, "dateText": None,
         "value": "抓取于 " + (pri_fetch[11:16] if pri_fetch else "—") + " · %d 个品种" % n_parts,
         "tool": "tools/fetch_prices.py",
         "src": "全国农产品批发市场价格信息系统（农业农村部信息中心）",
         "use": "生计账本的价格波动项"},

        {"k": "atmos", "short": "大气", "n": "大气风场与降水率",
         "kind": "replay", "freq": "固定回放",
         "date": None, "dateText": (atm_t0 or "")[2:7] + "→" + (atm_t1 or "")[2:7],
         "value": atmos_fmt + " 粒子",
         "tool": "tools/fetch_atmos.py + tools/track_atmos.py",
         "src": "NCEP/NCAR Reanalysis 1 · 850–925 hPa 风场 + 地面降水",
         "use": "内陆点位的水汽通路与雨水浓度"},

        {"k": "admin", "short": "区划", "n": "行政区划",
         "kind": "static", "freq": "年度",
         "date": None, "dateText": "年度", "value": admin_fmt + " 条",
         "tool": "构建时导入（源数据见 admin.js 首行）",
         "src": "阿里云 DataV GeoAtlas 官方区划",
         "use": "全国地点搜索与省均值权重投影"},

        {"k": "discharge", "short": "排放", "n": "排放轮次与总量",
         "kind": "manual", "freq": "约两月一轮",
         "date": None, "dateText": "第 " + rounds + " 轮",
         "value": tons_fmt + " 吨",
         "tool": "手工更新 data.js 的 OP.META",
         "src": "东京电力公司公告 / IAEA 审查报告",
         "use": "首页总量、时间轴与所有浓度换算的起点"},

        {"k": "routes", "short": "路径", "n": "抵达时间标定",
         "kind": "model", "freq": "季节重算",
         "date": None, "dateText": "文献锚点", "value": "240 d / 1200 d",
         "tool": "tools/fetch_mean_flow.py（月度流场积分）",
         "src": "清华团队 2021 年公开锚点 + 实测流场季节平均",
         "use": "「哪天到」这一核心答案"},

        {"k": "industry", "short": "产业", "n": "县域产业权重",
         "kind": "estimate", "freq": "年度",
         "date": None, "dateText": "估算",
         "value": "65 精细 + " + admin_fmt + " 省均值",
         "tool": "构建时整理（标注 EST）",
         "src": "全国渔业经济统计公报 / 县级统计年鉴（估算）",
         "use": "生计账本的依赖度、敏感度、信息不对称"}
    ]

    snaps = [s["date"] for s in sources if s["kind"] == "snapshot" and s["date"]]
    as_of = min(snaps) if snaps else None
    latest = max(snaps) if snaps else None

    manifest = {
        "generatedAt": datetime.now(CST).strftime("%Y-%m-%dT%H:%M+08:00"),
        "asOf": as_of,
        "latest": latest,
        "sources": sources
    }

    body = ("/* 自动生成，勿手改。由 tools/build_manifest.py 于 %s 生成。\n"
            "   数据时效的单一来源：界面上的每个日期都从这里取。 */\n"
            "window.OP = window.OP || {};\n"
            "OP.DATA_MANIFEST = %s;\n"
            % (manifest["generatedAt"],
               json.dumps(manifest, ensure_ascii=False, indent=2)))

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(body)

    print("写入", OUT)
    print("快照最早 %s / 最新 %s（asOf 取最早，保守口径）" % (as_of, latest))
    for s in sources:
        print("  %-10s %-12s %s" % (s["k"], s["kind"], s["date"] or s["value"]))


if __name__ == "__main__":
    main()
