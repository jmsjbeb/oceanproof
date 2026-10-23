// 小程序数据层一致性校验：用 node 同时加载「原站写法」和「小程序写法」，逐项比对。
// 用法：node tools/verify_miniapp_data.js
// 期望输出全部 OK；出现 DIFF 说明 build_miniapp_data.py 的转换规则需要更新。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const FILES = ['data.js', 'admin.js', 'boundary.js', 'land.js', 'prices.js',
  'currents.js', 'atmos_f.js', 'model.js'];

// A) 小程序写法（CommonJS）
const MP = require(path.join(ROOT, 'miniapp', 'data', 'index.js'));

// B) 原站写法（window 全局）——让 window 就是全局对象，模拟浏览器里 window.OP 与 OP 互通
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of FILES) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const WEB = ctx.window.OP;

let bad = 0;
const keys = o => Object.keys(o).sort().join(',');
const cmp = (name, a, b) => {
  const ok = String(a) === String(b);
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'DIFF ') + name + ': ' + a + ' | ' + b);
};

cmp('OP 键集合', keys(MP), keys(WEB));
cmp('ADMIN 条数', MP.ADMIN.length, WEB.ADMIN.length);
cmp('ADMIN 坏行', MP.ADMIN.filter(r => r.length !== 6).length,
  WEB.ADMIN.filter(r => r.length !== 6).length);
cmp('CITIES 条数', MP.CITIES.length, WEB.CITIES.length);
cmp('STATIONS 条数', MP.STATIONS.length, WEB.STATIONS.length);
cmp('ROUTES 键', Object.keys(MP.ROUTES).join('/'), Object.keys(WEB.ROUTES).join('/'));
cmp('流场 JSON 长度', JSON.stringify(MP.CURRENTS).length, JSON.stringify(WEB.CURRENTS).length);
cmp('大气 f 长度', MP.ATMOS_F.f.length, WEB.ATMOS_F.f.length);
cmp('海陆环数', MP.LAND_WORLD.length, WEB.LAND_WORLD.length);
cmp('国界环数', MP.CN_BOUNDARY.length, WEB.CN_BOUNDARY.length);
cmp('价格键数', Object.keys(MP.PRICES || {}).length, Object.keys(WEB.PRICES || {}).length);
cmp('META 版本', MP.META.version, WEB.META.version);

// 模型输出必须逐字段一致
const city = WEB.CITIES.find(c => c.n && c.n.indexOf('象山') >= 0);
if (city) {
  const pick = o => JSON.stringify({
    arr: o.arrivalDay, arrDate: o.arrivalDate, peak: o.peakConc,
    live: o.liveDay, eco: o.eco && o.eco.score
  });
  cmp('象山 assess', pick(MP.model.assess(city)), pick(WEB.model.assess(city)));
} else {
  console.log('DIFF 未找到「象山」，城市列表结构可能变了');
  bad++;
}

console.log(bad === 0 ? '\n全部一致。' : '\n有 ' + bad + ' 项不一致，请检查转换规则。');
process.exit(bad === 0 ? 0 : 1);
