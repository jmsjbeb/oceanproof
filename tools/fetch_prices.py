#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_prices.py — 从「全国农产品批发市场价格信息系统」(pfsc.agri.cn) 拉取真实行情，
生成 prices.js 供前端直接引用。

为什么需要它
------------
产品的「生计账本」需要真实价格，否则评审一问「你的价格从哪来」就答不上。
该站是农业农村部主办的官方批发价发布平台，但没有公开 API 文档。
本脚本用的是站点自己的前端接口（与其网页完全相同的调用），只读、低频、不绕过登录。

接口说明（2026-10 实测可用）
--------------------------
1) POST /price_portal/region/selectList
   返回全国省/市树，含 lng/lat。明文 JSON，无需鉴权。
2) POST /price_portal/index/growthRanking
   返回当日涨跌幅榜：产品名 + 品种代码 + 涨跌幅(%)。
   数据字段 data 为 AES-CBC 加密字符串，密钥内置于站点前端 JS。
3) POST /price_portal/index/getMarketReportPriceChart
   返回当日各批发市场报价序列（x=市场名，y=价格 元/公斤）。

合规与礼貌
----------
- 只做一次/日的快照抓取，不做高频轮询、不做并发轰炸。
- 抓取结果落盘为静态 JS，前端不直连该站（避免把官方站点当 CDN）。
- 数据版权归农业农村部；本项目只引用数值并标注来源与抓取时间。
- 若要长期使用，正确做法是走农业农村部数据开放申请，而不是长期依赖此脚本。

用法
----
    python tools/fetch_prices.py                # 抓取并写入 prices.js
    python tools/fetch_prices.py --out x.js
"""

import argparse
import base64
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad
except ImportError:
    sys.exit("需要 pycryptodome：pip install pycryptodome")

BASE = "https://pfsc.agri.cn"
# 站点前端 app.js 内置的 AES 密钥（CBC 模式，报文前 16 字节为 IV）
AES_KEY = b"7s9K$pG2xQ8zR5mB7vA3sD9fH2jW40cV"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# 我们关心的品种（与四大产业对应）。用于从涨跌幅榜里挑出相关行。
WATCH = {
    # 海水/淡水产品 —— 渔业
    "大黄花鱼": ("fish", "海水鱼"),
    "大带鱼": ("fish", "海水鱼"),
    "活鲫鱼": ("fish", "淡水鱼"),
    "花鲢活鱼": ("fish", "淡水鱼"),
    "活草鱼": ("fish", "淡水鱼"),
    "活鲤鱼": ("fish", "淡水鱼"),
    "白鲢活鱼": ("fish", "淡水鱼"),
    "活鸭": ("aqua", "养殖"),
    # 蔬菜 —— 沿岸农业
    "洋白菜": ("agri", "叶菜"),
    "大白菜": ("agri", "叶菜"),
    "生菜": ("agri", "叶菜"),
    "芹菜": ("agri", "叶菜"),
    "菠菜": ("agri", "叶菜"),
    "青椒": ("agri", "果菜"),
    "茄子": ("agri", "果菜"),
    "西红柿": ("agri", "果菜"),
    "黄瓜": ("agri", "果菜"),
    "菜花": ("agri", "花菜"),
    "莲藕": ("agri", "水生蔬菜"),
    "葱头": ("agri", "调味"),
    "大葱": ("agri", "调味"),
    "蒜薹": ("agri", "调味"),
    # 水果 —— 林业/园艺
    "巨峰葡萄": ("forest", "水果"),
    "鸭梨": ("forest", "水果"),
    "富士苹果": ("forest", "水果"),
    "菠萝": ("forest", "水果"),
    "西瓜": ("forest", "水果"),
    "香蕉": ("forest", "水果"),
}

COASTAL_PROV = {
    "辽宁", "河北", "天津", "山东", "江苏", "上海", "浙江",
    "福建", "广东", "广西", "海南",
}


def _decrypt(payload: str) -> str:
    iv = payload[:16].encode()
    ct = base64.b64decode(payload[16:])
    return unpad(AES.new(AES_KEY, AES.MODE_CBC, iv).decrypt(ct), 16).decode("utf-8")


def post(path: str, body: dict, timeout: int = 30):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA,
                 "Referer": BASE + "/"},
        method="POST",
    )
    raw = json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    data = raw.get("data")
    if isinstance(data, str) and len(data) > 32:
        try:
            data = json.loads(_decrypt(data))
        except Exception:
            pass  # 有些接口返回明文长字符串
    return raw.get("code"), data


def fetch_regions():
    """省/市树，带经纬度。"""
    code, data = post("/price_portal/region/selectList", {})
    if code != 0 or not isinstance(data, list):
        return []
    out = []
    for r in data:
        try:
            lon, lat = float(r.get("lng")), float(r.get("lat"))
        except (TypeError, ValueError):
            continue
        out.append({
            "id": r.get("id"), "name": r.get("name"),
            "short": r.get("shortName"), "pid": r.get("pid"),
            "lon": round(lon, 4), "lat": round(lat, 4),
        })
    return out


def _f(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def fetch_ranking():
    """当日品种行情：名称、代码、均价(元/公斤)、环比(%)、昨日均价。"""
    code, data = post("/price_portal/index/growthRanking", {})
    if code != 0 or not isinstance(data, dict):
        return None
    names = data.get("names") or []
    codes = data.get("codes") or []
    avg = data.get("avgPrice") or []
    chg = data.get("priceHbs") or []
    prev = data.get("lastAvgPrice") or []
    rows = []
    for i, n in enumerate(names):
        a, c, p = _f(avg[i] if i < len(avg) else None), \
                  _f(chg[i] if i < len(chg) else None), \
                  _f(prev[i] if i < len(prev) else None)
        if a is None:
            continue
        rows.append({
            "name": n,
            "code": codes[i] if i < len(codes) else "",
            "price": a,          # 元/公斤
            "chg": c,            # 环比 %
            "prev": p,
        })
    return {"date": (data.get("date") or [None])[0], "rows": rows}


def fetch_market_prices():
    """当日各批发市场报价（默认品种序列）。"""
    code, data = post("/price_portal/index/getMarketReportPriceChart", {})
    if code != 0 or not isinstance(data, dict):
        return None
    xs, ys = data.get("x") or [], data.get("y") or []
    pairs = []
    for x, y in zip(xs, ys):
        try:
            pairs.append((x, float(y)))
        except (TypeError, ValueError):
            continue
    if not pairs:
        return None
    agg = {}
    for m, p in pairs:
        agg.setdefault(m, []).append(p)
    markets = [{"name": k, "n": len(v), "avg": round(sum(v) / len(v), 2),
                "min": round(min(v), 2), "max": round(max(v), 2)}
               for k, v in agg.items()]
    markets.sort(key=lambda m: -m["n"])
    return {"date": data.get("date"), "markets": markets[:400],
            "totalRows": len(pairs)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prices.js"))
    args = ap.parse_args()

    now = datetime.now(timezone(timedelta(hours=8)))
    print("[1/3] 省/市树 …", flush=True)
    regions = fetch_regions()
    print("      ->", len(regions), "条")

    print("[2/3] 涨跌幅榜 …", flush=True)
    rank = fetch_ranking()
    print("      ->", (len(rank["rows"]) if rank else 0), "个品种")

    print("[3/3] 批发市场报价 …", flush=True)
    mp = fetch_market_prices()
    print("      ->", (len(mp["markets"]) if mp else 0), "个市场")

    # 挑出与四大产业相关的品种
    watch = []
    if rank:
        for row in rank["rows"]:
            hit = WATCH.get(row["name"])
            if hit:
                watch.append({**row, "sector": hit[0], "kind": hit[1]})
        watch.sort(key=lambda r: -abs(r["chg"] or 0))

    # 沿海省份的批发市场所在城市（用于地图标注）
    coastal = [r for r in regions
               if r.get("pid") not in ("0", None) and any(
                   r.get("short", "").startswith(p) or p in r.get("name", "")
                   for p in COASTAL_PROV)]

    payload = {
        "fetchedAt": now.strftime("%Y-%m-%dT%H:%M+08:00"),
        "date": (rank or {}).get("date") or (mp or {}).get("date") or now.strftime("%Y-%m-%d"),
        "source": "全国农产品批发市场价格信息系统（农业农村部信息中心）",
        "sourceUrl": "https://pfsc.agri.cn/",
        "watch": watch,
        "rankAll": (rank or {}).get("rows", [])[:40],
        "markets": (mp or {}).get("markets", [])[:60],
        "marketTotal": (mp or {}).get("totalRows", 0),
        "regions": len(regions),
        "coastalCities": len(coastal),
    }

    js = ("/* 自动生成，勿手改。由 tools/fetch_prices.py 于 %s 抓取。\n"
          "   来源：%s  %s  */\n"
          "window.OP = window.OP || {};\nOP.PRICES = %s;\n"
          % (now.strftime("%Y-%m-%d %H:%M"), payload["source"], payload["sourceUrl"],
             json.dumps(payload, ensure_ascii=False, indent=1)))
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(js)
    print("已写入", args.out)
    print("日期", payload["date"], "| 关注品种", len(watch), "| 市场", len(payload["markets"]))


if __name__ == "__main__":
    main()
