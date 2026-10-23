var OP = require('./shared.js');
/* 自动生成，勿手改。由 tools/build_manifest.py 于 2026-10-23T15:45+08:00 生成。
   数据时效的单一来源：界面上的每个日期都从这里取。 */
OP = OP || {};
OP.DATA_MANIFEST = {
  "generatedAt": "2026-10-23T15:45+08:00",
  "asOf": "2026-10-16",
  "latest": "2026-10-18",
  "sources": [
    {
      "k": "currents",
      "short": "流场",
      "n": "海洋表层流场",
      "kind": "snapshot",
      "freq": "日频",
      "date": "2026-10-16",
      "dateText": null,
      "value": "0.25° 日频 u/v 场",
      "tool": "tools/fetch_currents.py",
      "src": "NOAA CoastWatch · Blended NRT Surface Currents",
      "use": "溯源地图的流线与粒子推进方向"
    },
    {
      "k": "prices",
      "short": "价格",
      "n": "农产品批发价",
      "kind": "snapshot",
      "freq": "日频（工作日）",
      "date": "2026-10-18",
      "dateText": null,
      "value": "抓取于 15:24 · 97 个品种",
      "tool": "tools/fetch_prices.py",
      "src": "全国农产品批发市场价格信息系统（农业农村部信息中心）",
      "use": "生计账本的价格波动项"
    },
    {
      "k": "atmos",
      "short": "大气",
      "n": "大气风场与降水率",
      "kind": "replay",
      "freq": "固定回放",
      "date": null,
      "dateText": "23-08→24-10",
      "value": "600,572 粒子",
      "tool": "tools/fetch_atmos.py + tools/track_atmos.py",
      "src": "NCEP/NCAR Reanalysis 1 · 850–925 hPa 风场 + 地面降水",
      "use": "内陆点位的水汽通路与雨水浓度"
    },
    {
      "k": "admin",
      "short": "区划",
      "n": "行政区划",
      "kind": "static",
      "freq": "年度",
      "date": null,
      "dateText": "年度",
      "value": "3,241 条",
      "tool": "构建时导入（源数据见 admin.js 首行）",
      "src": "阿里云 DataV GeoAtlas 官方区划",
      "use": "全国地点搜索与省均值权重投影"
    },
    {
      "k": "discharge",
      "short": "排放",
      "n": "排放轮次与总量",
      "kind": "manual",
      "freq": "约两月一轮",
      "date": null,
      "dateText": "第 23 轮",
      "value": "181,000 吨",
      "tool": "手工更新 data.js 的 OP.META",
      "src": "东京电力公司公告 / IAEA 审查报告",
      "use": "首页总量、时间轴与所有浓度换算的起点"
    },
    {
      "k": "routes",
      "short": "路径",
      "n": "抵达时间标定",
      "kind": "model",
      "freq": "季节重算",
      "date": null,
      "dateText": "文献锚点",
      "value": "240 d / 1200 d",
      "tool": "tools/fetch_mean_flow.py（月度流场积分）",
      "src": "清华团队 2021 年公开锚点 + 实测流场季节平均",
      "use": "「哪天到」这一核心答案"
    },
    {
      "k": "industry",
      "short": "产业",
      "n": "县域产业权重",
      "kind": "estimate",
      "freq": "年度",
      "date": null,
      "dateText": "估算",
      "value": "65 精细 + 3,241 省均值",
      "tool": "构建时整理（标注 EST）",
      "src": "全国渔业经济统计公报 / 县级统计年鉴（估算）",
      "use": "生计账本的依赖度、敏感度、信息不对称"
    }
  ]
};
