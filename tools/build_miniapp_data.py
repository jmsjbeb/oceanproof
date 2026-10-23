# -*- coding: utf-8 -*-
"""把站点里的浏览器全局数据文件，转成小程序可用的 CommonJS 模块。

站点写法：window.OP = window.OP || {};  然后 OP.XXX = ...
小程序写法：var OP = require('./shared.js');  然后 OP.XXX = ...

用法：python tools/build_miniapp_data.py
每次 tools/refresh.py 刷新数据后，都要重跑一次本脚本。
"""
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(HERE)
OUT = os.path.join(SITE, "miniapp", "data")

# 顺序即依赖顺序：model.js 读取 OP.ATMOS_F / OP.CURRENTS，必须排在它们之后
FILES = [
    ("data.js", "META / 排放轮次 / 路径锚点 / 站点清单"),
    ("admin.js", "行政区划 3,241 条"),
    ("boundary.js", "国界轮廓"),
    ("land.js", "海岸线"),
    ("prices.js", "批发价"),
    ("currents.js", "表层流场"),
    ("atmos_f.js", "大气风场回放"),
    ("model.js", "抵达时间与浓度模型"),
]

SHARED = """// 共享的 OP 对象：所有数据模块 require 同一份，等价于浏览器的全局 window.OP
module.exports = {};
"""

INDEX_HEAD = """// 自动生成，勿手改。由 tools/build_miniapp_data.py 生成。
// 用法：var OP = require('../../data/index.js');
var OP = require('./shared.js');
"""


def convert(name):
    src = io.open(os.path.join(SITE, name), encoding="utf-8").read()

    # 1) 全局初始化语句 -> require 共享对象
    src = re.sub(r"window\.OP\s*=\s*window\.OP\s*\|\|\s*\{\}\s*;",
                 "var OP = require('./shared.js');", src)

    # 2) 其余 window.OP 引用
    src = src.replace("window.OP", "OP")

    # 3) 文件里没有全局初始化语句的（如 land.js），自己补一行
    if "var OP = require('./shared.js');" not in src:
        src = "var OP = require('./shared.js');\n" + src

    return src


def main():
    os.makedirs(OUT, exist_ok=True)

    io.open(os.path.join(OUT, "shared.js"), "w", encoding="utf-8").write(SHARED)

    total = 0
    for name, desc in FILES:
        dst = convert(name)
        path = os.path.join(OUT, name)
        io.open(path, "w", encoding="utf-8").write(dst)
        size = os.path.getsize(path)
        total += size
        print("  %-14s %8d 字节  %s" % (name, size, desc))

    idx = [INDEX_HEAD]
    for name, _ in FILES:
        idx.append("require('./%s');" % name)
    idx.append("\nmodule.exports = OP;\n")
    io.open(os.path.join(OUT, "index.js"), "w", encoding="utf-8").write("\n".join(idx))

    # 数据时效清单
    man = io.open(os.path.join(SITE, "manifest-data.js"), encoding="utf-8").read()
    man = man.replace("window.OP", "OP")
    if "var OP = require('./shared.js');" not in man:
        man = "var OP = require('./shared.js');\n" + man
    io.open(os.path.join(OUT, "manifest.js"), "w", encoding="utf-8").write(man)
    msize = os.path.getsize(os.path.join(OUT, "manifest.js"))
    total += msize
    print("  %-14s %8d 字节  数据时效清单" % ("manifest.js", msize))

    print("\n数据层合计 %.0f KB -> %s" % (total / 1024.0, OUT))


if __name__ == "__main__":
    main()
