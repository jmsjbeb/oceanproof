/* ═══════════════════════════════════════════════════════════
   海证 OceanProof — 应用层
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var M = OP.model;
  var state = { loc: null, view: 'dash', mapDay: 0, playing: false, raf: 0 };

  var ICON = {
    dash: '<path d="M3.5 10.5 12 3.5l8.5 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M5.5 9.5V20h13V9.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    map: '<path d="M9 3.5 3.5 6v14.5L9 18l6 2.5 5.5-2.5V3.5L15 6 9 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 3.5V18M15 6v14.5" stroke="currentColor" stroke-width="1.6"/>',
    impact: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    evidence: '<path d="M11 4.5c4.5 0 8 3 8 7.5s-3.5 7.5-8 7.5-8-3-8-7.5 3.5-7.5 8-7.5Z" stroke="currentColor" stroke-width="1.6"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    action: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/>',
    method: '<path d="M6 3.5h9l4 4v13H6Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14.5 3.5v4.5H19M9 12h6M9 16h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    brief: '<path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 6-5.3-2.8L6.7 20l1-6L3.4 9.9l6-.9Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    clock: '<circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.4V12l3.3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };
  var NAV = [
    { k: 'brief', n: '评审速览', i: 'brief' },
    { k: 'dash', n: '我的海岸', i: 'dash' },
    { k: 'map', n: '溯源地图', i: 'map' },
    { k: 'impact', n: '影响评估', i: 'impact' },
    { k: 'evidence', n: '监测证据', i: 'evidence' },
    { k: 'action', n: '行动建议', i: 'action' },
    { k: 'data', n: '数据时效', i: 'clock' },
    { k: 'method', n: '方法学与试点', i: 'method' }
  ];

  var NOW_DAY = Math.round((Date.now() - M.START) / 86400000);

  /* ══════════ 通用工具 ══════════ */
  function num(v, d) {
    if (!isFinite(v)) return '—';
    return v.toFixed(d === undefined ? 2 : d);
  }
  function sci(v) {
    if (v === 0) return '0';
    var e = Math.floor(Math.log10(Math.abs(v)));
    var m = v / Math.pow(10, e);
    return m.toFixed(1) + '×10<sup>' + e + '</sup>';
  }
  function fmtInt(v) {
    if (!isFinite(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }
  /* 数量级表述：浓度输入是量级标定（C₀ 不确定度约一个数量级），
     界面一律按量级表述，不呈现多位有效数字的假精度 */
  function ordersBelow(ratio) {
    if (!(ratio > 0)) return '—';
    return '低 ' + Math.round(-Math.log10(ratio)) + ' 个数量级';
  }
  function magOf(v) {
    return (window.OP && OP.model.magnitude) ? OP.model.magnitude(v) : sci(v);
  }
  /* SVG <text> 里不能用 <sup>，用 Unicode 上标 */
  function sciPlain(v) {
    if (!v) return '0';
    var e = Math.floor(Math.log10(Math.abs(v)));
    var m = v / Math.pow(10, e);
    var sup = String(e).replace('-', '⁻').replace(/[0-9]/g, function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]; });
    return m.toFixed(1) + '×10' + sup;
  }

  /* 数据状态标签：实测 / 模型 / 估算 / 示意 */
  var PROV = {
    obs:   ['实测', '公开监测或官方统计，引用需核对原始公告'],
    model: ['模型', '由筛选级模型推算，附误差范围'],
    est:   ['估算', '基于公开统计的权重估计，待替换'],
    ref:   ['参照', '公开报道的量级参照，非本站实测'],
    schem: ['示意', '用于可视化，不构成结论']
  };
  function prov(k) {
    var p = PROV[k] || PROV.model;
    return '<span class="prov p-' + k + '" title="' + p[1] + '">' + p[0] + '</span>';
  }

  /* ══════════ 登录 ══════════ */
  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    var qs = {};
    location.search.replace(/[?&]([^=&]+)=([^&]*)/g, function (_, k, v) { qs[k] = decodeURIComponent(v); });
    if (qs.loc) {
      var qc = null;
      if (qs.loc.indexOf('adm:') === 0 && OP.ADMIN && OP.ADMIN[+qs.loc.slice(4)]) {
        qc = cityFromAdmin(OP.ADMIN[+qs.loc.slice(4)]);
      } else {
        qc = OP.CITIES.filter(function (x) { return x.n === qs.loc; })[0];
      }
      if (qc) state.loc = qc;
    }
    if (!state.loc) {
      var saved = null;
      try { saved = localStorage.getItem('op.loc'); } catch (e) {}
      if (saved) {
        var c = null;
        if (saved.indexOf('adm:') === 0 && OP.ADMIN && OP.ADMIN[+saved.slice(4)]) {
          c = cityFromAdmin(OP.ADMIN[+saved.slice(4)]);
        } else {
          c = OP.CITIES.filter(function (x) { return x.n === saved; })[0];
        }
        if (c) state.loc = c;
      }
    }
    if (!state.loc) state.loc = OP.CITIES.filter(function (x) { return x.n === '象山'; })[0];

    // 先建一次流场：让「监测证据」等页面能正确判断是否已接入实测数据
    if (OP.field && !OP.field._built) {
      try { OP.field.build(); OP.field._built = true; } catch (e) {}
    }

    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault(); enter();
    });
    $('#guestBtn').addEventListener('click', enter);
    $('#locchip').addEventListener('click', openModal);
    $('#relocate').addEventListener('click', openModal);
    $('#asofPill').addEventListener('click', function () { go('data'); });
    $('#modalX').addEventListener('click', closeModal);
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
    $('#locSearch').addEventListener('input', function (e) { renderLocList(e.target.value); });
    buildNav();

    if (qs.auto === '1') {
      try { localStorage.setItem('op.seen', '1'); } catch (e) {}
      enter();
      if (qs.view) setTimeout(function () { go(qs.view); }, 60);
    }
  }

  function enter() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#userChip').textContent = ($('#email').value || 'D').charAt(0).toUpperCase();
    refreshLoc();
    go('brief');
    if (!localStorage.getItem('op.seen')) {
      setTimeout(openModal, 420);
      try { localStorage.setItem('op.seen', '1'); } catch (e) {}
    }
  }

  /* ══════════ 导航 ══════════ */
  function buildNav() {
    $('#nav').innerHTML = NAV.map(function (n) {
      return '<button class="nav-item" data-k="' + n.k + '">' +
        '<svg viewBox="0 0 24 24" fill="none">' + ICON[n.i] + '</svg>' +
        '<span>' + n.n + '</span></button>';
    }).join('');
    $$('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.k); });
    });
  }

  function go(k) {
    if (state.view === 'map' && k !== 'map') {
      try { OP.flowmap.stop(); } catch (e) {}
      stopPlay();
    }
    state.view = k;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('on', b.dataset.k === k); });
    var v = $('#view');
    v.scrollTop = 0;
    if (k === 'brief') v.innerHTML = viewBrief();
    else if (k === 'dash') v.innerHTML = viewDash();
    else if (k === 'map') { v.innerHTML = viewMap(); initMap(); }
    else if (k === 'impact') v.innerHTML = viewImpact();
    else if (k === 'evidence') v.innerHTML = viewEvidence();
    else if (k === 'action') v.innerHTML = viewAction();
    else if (k === 'data') v.innerHTML = viewData();
    else if (k === 'method') v.innerHTML = viewMethod();
    wire(k);
  }

  function refreshLoc() {
    var c = state.loc;
    $('#locName').textContent = c.n + ' · ' + c.p;
    $('#locCo').textContent = c.lon.toFixed(2) + '°E  ' + c.lat.toFixed(2) + '°N';
    var a = mdOf('currents'), b = mdOf('prices');
    $('#asof').textContent = (a && b)
      ? '流场 ' + mmdd(a) + ' · 价格 ' + mmdd(b)
      : '数据截至 ' + OP.META.asOf;
    try { localStorage.setItem('op.loc', c._key || c.n); } catch (e) {}
  }

  /* ══════════ 数据时效 ══════════
     所有日期只有一个来源：manifest-data.js（由 tools/build_manifest.py 生成）。
     界面上任何写死的日期都会漂移，所以这里不写死。 */
  function mdOf(k) {
    var m = OP.DATA_MANIFEST;
    if (!m || !m.sources) return null;
    for (var i = 0; i < m.sources.length; i++) {
      if (m.sources[i].k === k) return m.sources[i].date;
    }
    return null;
  }
  function mmdd(d) { return d ? d.slice(5) : '—'; }
  function daysAgo(d) {
    if (!d) return null;
    var t = Date.parse(d + 'T00:00:00+08:00');
    if (!isFinite(t)) return null;
    return Math.max(0, Math.round((Date.now() - t) / 86400000));
  }

  /* ══════════ 地点选择 ══════════ */
  var QUICK = ['象山', '舟山', '荣成', '连江', '湛江', '北海', '大连', '上海', '成都'];
  function openModal() {
    $('#modal').classList.remove('hidden');
    $('#locSearch').value = '';
    $('#quickPick').innerHTML = QUICK.map(function (n) {
      return '<button data-q="' + n + '">' + n + '</button>';
    }).join('');
    $$('#quickPick button').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.dataset.q); });
    });
    renderLocList('');
    setTimeout(function () { $('#locSearch').focus(); }, 80);
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  /* ══════════ 行政区支持（3,241 个省/市/区县，阿里 DataV GeoAtlas 官方区划） ══════════
     65 个精细点位有完整县域产业数据；行政区点位用省均值产业权重（标注估算）。
     ADMIN 行格式：[名称, 经度, 纬度, 级别, 所属省, 离海距离km(-1=缺测)] */
  var LV_CN = { province: '省级', city: '地级', district: '区县级' };
  var PROV_AVG = {};
  (function () {
    var acc = {};
    OP.CITIES.forEach(function (c) {
      var p = c.p;
      if (!acc[p]) acc[p] = { dep: 0, mkt: 0, info: 0, pr: 0, n: 0 };
      acc[p].dep += c.dep; acc[p].mkt += c.mkt; acc[p].info += c.info;
      acc[p].pr += (c.pr || 800); acc[p].n++;
    });
    for (var k in acc) {
      PROV_AVG[k] = { dep: acc[k].dep / acc[k].n, mkt: acc[k].mkt / acc[k].n, info: acc[k].info / acc[k].n, pr: acc[k].pr / acc[k].n };
    }
  })();

  function cityFromAdmin(row, idx) {
    var n = row[0], lon = row[1], lat = row[2], prov = row[4], d = row[5];
    var av = PROV_AVG[prov] || { dep: 0.5, mkt: 0.5, info: 0.5, pr: 800 };
    var coast = d >= 0 && d < 60;
    return {
      n: n, p: prov, lon: lon, lat: lat,
      t: coast ? 'coast' : 'inland',
      dep: av.dep, mkt: av.mkt, info: av.info, pr: Math.round(av.pr),
      share: coast ? [0.42, 0.35, 0.12, 0.11] : [0.10, 0.20, 0.55, 0.15],
      _admin: true, _key: 'adm:' + idx
    };
  }

  function pick(key) {
    var c = null;
    if (typeof key === 'string' && key.indexOf('adm:') === 0) {
      var idx = +key.slice(4);
      if (OP.ADMIN && OP.ADMIN[idx]) c = cityFromAdmin(OP.ADMIN[idx], idx);
    } else {
      c = OP.CITIES.filter(function (x) { return x.n === key; })[0];
    }
    if (!c) return;
    state.loc = c; refreshLoc(); closeModal(); go(state.view);
  }

  function renderLocList(q) {
    q = (q || '').trim();
    var items = [];
    /* 1) 65 个精细点位（有完整县域数据）优先 */
    OP.CITIES.filter(function (c) {
      return !q || c.n.indexOf(q) >= 0 || c.p.indexOf(q) >= 0;
    }).slice(0, q ? 24 : 40).forEach(function (c) {
      items.push({ key: c.n, n: c.n, p: c.p, tag: '', cls: '' });
    });
    /* 2) 行政区补充（任意省/市/区县名），精确匹配置前 */
    if (OP.ADMIN && q) {
      var admHits = [];
      for (var i = 0; i < OP.ADMIN.length; i++) {
        var r = OP.ADMIN[i];
        if (r[0].indexOf(q) >= 0 || r[4].indexOf(q) >= 0) {
          admHits.push({ i: i, exact: r[0] === q ? 0 : 1, lv: r[3] });
        }
      }
      admHits.sort(function (a, b) { return a.exact - b.exact; });
      admHits.slice(0, 16).forEach(function (h) {
        var r = OP.ADMIN[h.i];
        items.push({
          key: 'adm:' + h.i,
          n: r[0],
          p: r[4] + ' · ' + (LV_CN[r[3]] || ''),
          tag: '省均值权重',
          cls: ' adm'
        });
      });
    }
    items = items.slice(0, 40);
    $('#locList').innerHTML = items.map(function (it) {
      var a = null;
      if (it.key.indexOf('adm:') === 0) {
        var c = cityFromAdmin(OP.ADMIN[+it.key.slice(4)]);
        a = M.assess(c);
      } else {
        a = M.assess(OP.CITIES.filter(function (x) { return x.n === it.key; })[0]);
      }
      var d = a.inland ? '内陆' : (a.tArr + ' 天');
      return '<button class="loc-item' + it.cls + '" data-k="' + it.key + '">' +
        '<span class="li-n">' + it.n + '</span>' +
        '<span class="li-p">' + it.p + (it.tag ? ' · ' + it.tag : '') + '</span>' +
        '<span class="li-d">' + d + '</span></button>';
    }).join('');
    $$('#locList .loc-item').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.dataset.k); });
    });
  }

  /* ══════════ 图表：浓度曲线 ══════════ */
  function chartSVG(cd) {
    var a = cd.assess, pts = cd.pts, span = cd.span;
    var W = 660, H = 210, L = 52, R = 14, T = 16, B = 28;
    var iw = W - L - R, ih = H - T - B;
    var peak = 0;
    pts.forEach(function (p) { if (p.c > peak) peak = p.c; });
    if (peak <= 0) peak = 1;
    var maxY = peak * 1.12;
    function X(t) { return L + (t / span) * iw; }
    function Y(c) { return T + ih - (c / maxY) * ih; }

    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p.c).toFixed(1); }).join(' ');
    var area = line + ' L' + X(span).toFixed(1) + ' ' + (T + ih) + ' L' + L + ' ' + (T + ih) + ' Z';

    var g = '';
    for (var i = 0; i <= 4; i++) {
      var y = T + ih * i / 4;
      var val = maxY * (1 - i / 4);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="rgba(255,255,255,.055)" stroke-width="1"/>';
      g += '<text x="' + (L - 9) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" class="ch-lb">' + (val >= 0.001 ? val.toFixed(3) : val.toExponential(0)) + '</text>';
    }
    // x ticks
    var xt = '';
    for (var j = 0; j <= 4; j++) {
      var t = span * j / 4;
      var d = M.dateOf(t);
      xt += '<text x="' + X(t).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" class="ch-lb">' + M.fmt(d) + '</text>';
    }

    var mk = '';
    if (!a.inland) {
      var ax = X(a.tArr);
      mk += '<line x1="' + ax.toFixed(1) + '" y1="' + T + '" x2="' + ax.toFixed(1) + '" y2="' + (T + ih) + '" stroke="rgba(242,179,75,.55)" stroke-width="1" stroke-dasharray="3 4"/>';
      mk += '<text x="' + (ax - 6).toFixed(1) + '" y="' + (T + 12) + '" text-anchor="end" class="ch-lb" fill="rgba(242,179,75,.9)">首次抵达 ' + a.tArr + ' 天</text>';
      var px = X(a.tArr * 2.45);
      mk += '<circle cx="' + px.toFixed(1) + '" cy="' + Y(peak).toFixed(1) + '" r="3.4" fill="#2fe3c0"/>';
      mk += '<text x="' + (px + 7).toFixed(1) + '" y="' + (Y(peak) - 6).toFixed(1) + '" class="ch-lb" fill="rgba(47,227,192,.95)">峰值 ' + magOf(peak) + ' Bq/L（量级）</text>';
    }
    if (NOW_DAY < span) {
      var nx = X(NOW_DAY);
      mk += '<line x1="' + nx.toFixed(1) + '" y1="' + T + '" x2="' + nx.toFixed(1) + '" y2="' + (T + ih) + '" stroke="rgba(255,255,255,.35)" stroke-width="1"/>';
      mk += '<text x="' + (nx - 5).toFixed(1) + '" y="' + (T + ih - 4) + '" text-anchor="end" class="ch-lb" fill="rgba(255,255,255,.55)">今日</text>';
    }

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#2fe3c0" stop-opacity=".26"/>' +
      '<stop offset="100%" stop-color="#2fe3c0" stop-opacity="0"/></linearGradient></defs>' +
      g + '<path d="' + area + '" fill="url(#ag)"/>' +
      '<path d="' + line + '" fill="none" stroke="#2fe3c0" stroke-width="1.7" stroke-linejoin="round"/>' +
      mk + xt +
      '<text x="' + (L - 9) + '" y="' + (T - 5) + '" text-anchor="end" class="ch-lb">Bq/L</text>' +
      '</svg>';
  }

  /* ══════════ 视图 1：我的海岸 ══════════ */
  function phaseOf(a) {
    if (a.inland) return { n: '市场传导', c: 'blue' };
    if (NOW_DAY < a.tArr) return { n: '输运中', c: 'blue' };
    var u = (NOW_DAY - a.tArr) / (a.tArr * 1.45);
    if (u < 0.85) return { n: '浓度上升期', c: 'rad' };
    if (u < 1.5) return { n: '峰值平台期', c: 'rad' };
    return { n: '浓度回落期', c: 'teal' };
  }

  function viewDash() {
    var a = M.assess(state.loc);
    var cd = M.curve(state.loc, 130);
    var ph = phaseOf(a);
    var at = a.inland ? atmosOf(state.loc) : null;
    var since = a.inland ? 0 : NOW_DAY - a.tArr;
    var durY = a.inland ? 0 : ((a.pulseEnd - a.arrivalDate) / 86400000 / 365);

    var headline = a.inland
      ? '海水到不了这里，但<span style="color:var(--blue)">水汽可以</span>'
      : (since > 0 ? '已进入影响窗口 <span class="num" style="color:var(--teal)">' + fmtInt(since) + '</span> 天' : '预计 <span class="num" style="color:var(--amber)">' + fmtInt(-since) + '</span> 天后抵达');

    var kpi2 = a.inland ? '—' : (M.fmt(a.arrivalDate) + ' → ' + M.fmt(a.pulseEnd));
    var kpi2note = a.inland ? '无海洋输运段' : '单轮脉冲持续 <b>' + durY.toFixed(1) + ' 年</b>';

    var tl = timelineHTML(a);

    return '<div class="phead"><div>' +
      '<div class="eyebrow">MY SHORELINE · ' + state.loc.p + ' / ' + state.loc.n + '</div>' +
      '<h1 style="margin-top:8px">' + headline + '</h1>' +
      '<p>' + (a.inland
        ? '这里距最近海域 <b style="color:var(--txt)">' + fmtInt(Math.round(at.dCoast)) + ' km</b>，海水本身到不了。但氚以 HTO 形式存在，会随蒸发进入水汽、随环流输送、随降水落回地面——这是一条真实存在、量级极低的大气通路。'
        : '依据黑潮—东海陆架输运路径推算，日本福岛排放的氚质点在 <b style="color:var(--txt)">第 ' + a.tArr + ' 天</b> 抵达该海岸。当前处于<b style="color:var(--txt)">' + ph.n + '</b>。') +
      '</p></div>' +
      '<div class="right"><span class="tag t-' + ph.c + '">' + ph.n + '</span>' +
      '<span class="tag t-dim">' + (a.inland ? '内陆 · 大气通路' : a.routeName) + '</span>' +
      (state.loc._admin ? '<span class="tag t-rad" title="该点位为全国 3,241 行政区之一，产业权重取所属省均值（估算）">行政区 · 省均值权重</span>' : '') +
      '</div></div>' +

      '<div class="kpis">' +
      '<div class="kpi"><div class="k-lab">' + (a.inland ? '大气抵达' : '首次抵达') + prov('model') + '</div>' +
      '<div class="k-val">' + (a.inland ? at.tVapor.toFixed(0) + '<small> 天</small>' : M.fmtFull(a.arrivalDate)) + '</div>' +
      '<div class="k-note">' + (a.inland
        ? '水汽滞留 9 天 · 海盐气溶胶 <b>' + (at.tSpray < 1 ? Math.round(at.tSpray * 24) + ' 小时' : at.tSpray.toFixed(1) + ' 天') + '</b>'
        : '排放起点后 <b>' + a.tArr + ' 天</b> · 横向偏离 ' + a.lateral.toFixed(2) + '°') + '</div></div>' +

      '<div class="kpi"><div class="k-lab">' + (a.inland ? '雨水浓度' : '影响窗口') + prov(a.inland ? 'model' : 'model') + '</div>' +
      '<div class="k-val" style="font-size:' + (a.inland ? '24px' : '21px') + '">' + (a.inland ? magOf(at.cRain) : kpi2) + '</div>' +
      '<div class="k-note">' + (a.inland
        ? 'Bq/L 量级 · 为指导值的 <b>' + ordersBelow(at.ratio) + '</b>'
        : kpi2note) + '</div></div>' +

      '<div class="kpi ' + (a.L >= 70 ? 'warn' : '') + '"><div class="k-lab">生计压力指数' + prov('est') + '</div>' +
      '<div class="k-val">' + a.L + '<small>/100</small></div>' +
      '<div class="k-note">等级 <b>' + a.liveTier + '</b> · 辐射强度 ' + (a.inland ? at.tier : a.radTier) + '</div></div>' +
      '</div>' +

      (a.inland
        ? atmosHTML(at)
        : '<div class="grid" style="grid-template-columns:1.55fr 1fr;margin-bottom:16px">' +
          '<div class="card"><div class="card-h"><h3>单轮脉冲浓度响应</h3><span class="sub">Bq/L · 筛选级模型</span></div>' +
          chartSVG(cd) +
          '<p class="tiny" style="margin-top:8px">曲线为单轮排放的脉冲响应：上升—峰值—回落。由于排放计划持续至 2053 年，实际背景浓度为多轮叠加，回落段不会真正归零。</p>' +
          '</div>' +
          '<div class="card pad0"><div class="card-h" style="padding:18px 20px 0;margin-bottom:14px"><h3>双重账本</h3><span class="sub">DUAL LEDGER</span></div>' +
          ledgerHTML(a, null) + '</div>' +
          '</div>') +

      (a.inland
        ? '<div class="card pad0" style="margin-bottom:16px"><div class="card-h" style="padding:18px 20px 0;margin-bottom:14px">' +
          '<h3>双重账本</h3><span class="sub">DUAL LEDGER</span></div>' + ledgerHTML(a, at) + '</div>'
        : '') +

      '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>影响时间轴</h3><span class="sub">2023.08 — 2053.03</span></div>' +
      tl + '</div>' +

      foodHTML(a, at) +

      '<div class="card pad0" style="margin-bottom:16px"><div class="card-h" style="padding:18px 20px 0;margin-bottom:12px">' +
      '<h3>生计账本的真实一侧</h3><span class="sub">沿海相关品种 · 当日报价</span></div>' +
      priceFeedHTML(6) + '</div>' +

      '<div class="grid" style="grid-template-columns:1.55fr 1fr">' +
      '<div class="card"><div class="card-h"><h3>四大产业暴露度</h3><span class="sub">0–100 · 估算</span></div>' +
      sectorHTML(a) + '</div>' +
      '<div class="card"><div class="card-h"><h3>模型结论</h3><span class="sub">CALIBRATED BRIEF</span></div>' +
      advisoryHTML(a) + '</div>' +
      '</div>';
  }

  /* ══════════ 食用安全性卡 ══════════ */
  function foodHTML(a, at) {
    // 内陆城市吃的鱼来自沿海产区，用全国最高沿岸浓度估算
    var cW = at ? M.peakConc(223) : a.cMax;
    var fd = M.food(cW);
    var src = at ? '取东海近岸峰值（内陆水产品主要来自沿海产区）' : '取本地点位峰值浓度';

    function row(k, v, note) {
      return '<tr><td style="color:var(--mut)">' + k + '</td>' +
        '<td class="num" style="text-align:right;color:var(--txt)">' + v + '</td>' +
        '<td class="tiny muted" style="padding-left:12px">' + (note || '') + '</td></tr>';
    }

    /* 诚实原则：C0 = 0.019 是量级标定常数、不确定度约一个数量级，
       所以界面只呈现量级区间，不呈现多位有效数字的假精度 */
    return '<div class="card" style="margin-bottom:16px">' +
      '<div class="card-h"><h3>这些鱼还能不能吃</h3><span class="sub">FOOD SAFETY · 量级换算</span></div>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr;gap:20px">' +
      '<div><table><tbody>' +
      row('海水氚浓度', '10⁻³ ~ 10⁻¹ <small>Bq/L</small>', src + ' · 量级区间') +
      row('鱼肉氚浓度', '10⁻³ ~ 10⁻¹ <small>Bq/kg</small>', '浓缩系数 CF ≈ 1（HTO 不生物富集）') +
      row('占食品指导值', '< 1%', '指导值 1×10⁴ Bq/kg（Codex / 日本指标值）') +
      row('吃到限值的量', '> 10² <small>kg/天</small>', '按上限浓度连续折算——物理上不可能') +
      '</tbody></table></div>' +
      '<div><table><tbody>' +
      row('吃 1 kg 的剂量', '10⁻¹⁴ ~ 10⁻¹² <small>Sv</small>', '剂量系数 1.8×10⁻¹¹ Sv/Bq（ICRP 72）') +
      row('按 50 kg/年', fd.magPerYearLo + ' ~ ' + fd.magPerYearHi + ' <small>Sv/年</small>', '中国人均水产品消费量级') +
      row('相当于天然本底', '低 ' + fd.ordersBelow + ' 个数量级', '本底 2.4 mSv/年（UNSCEAR）· 取最保守一端') +
      row('相当于胸片', '< 10⁻⁵ <small>次</small>', '一次胸片约 0.02 mSv') +
      '</tbody></table></div></div>' +
      '<div class="adv" style="margin-top:14px;border-left:2px solid rgba(47,227,192,.55);padding-left:12px">' +
      '<h4 style="color:var(--teal)">结论：' + fd.verdict + '</h4>' +
      '<p>按本模型给出的量级，这种鱼<b>不存在可测量的辐射风险</b>——即便把标定常数放大十倍，' +
      '剂量仍比天然本底低 ' + fd.ordersBelow + ' 个数量级。真正的风险仍然是市场端——' +
      '一旦某地产区被贴上标签，价格和订单的变化会比剂量快几个数量级。' +
      '这条结论只对"氚"成立，不覆盖铯-137、锶-90 等其他核素，也不构成食品安全判定。</p></div>' +
      '<div class="tiny" style="margin-top:10px;opacity:.7">换算链：海水浓度 →（CF≈1）→ 鱼肉浓度 →（剂量系数）→ 待积有效剂量 →（对比本底）。' +
      '剂量系数、指导值、本底值均出自公开文件；海水浓度为量级标定（不确定度约一个数量级），故只给区间。<br>' +
      '为何不给更多位数：<b>C₀ 是标定常数，不是实测值</b>。把一位有效数字的输入算成七位有效数字的输出，是假精度。</div></div>';
  }

  function ledgerHTML(a, at) {
    var inland = !!at;
    var ratio = inland ? at.ratio : a.ratio;
    var logR = inland ? at.logRatio : a.logRatio;
    var mag = Math.round(-logR);
    return '<div class="ledger">' +
      '<div>' +
      '<div class="lg-head"><span class="lg-t">辐射账本' + prov('model') + '</span><span class="tag t-' + (inland ? 'teal' : a.radColor) + '">' + (inland ? at.tier : a.radTier) + '</span></div>' +
      '<div class="lg-sub">' + (inland ? '雨水浓度 / WHO 饮用水指导值' : '峰值浓度 / WHO 饮用水指导值') + '</div>' +
      /* 不给 1/x,xxx,xxx 的假精度：浓度是量级标定，结论只说到数量级 */
      '<div class="num" style="font-size:24px;margin-bottom:2px">低 ' + mag + ' 个数量级</div>' +
      '<div class="tiny" style="margin-bottom:12px">' + (inland
        ? '雨水约 ' + magOf(at.cRain) + ' Bq/L 量级；标定常数 C₀ 不确定度约一个数量级，故按数量级表述'
        : '峰值约 ' + magOf(a.cMax) + ' Bq/L 量级；标定常数 C₀ 不确定度约一个数量级，故按数量级表述') + '</div>' +
      '<div class="gauge g-teal" style="position:relative"><i style="width:' + Math.max(0.6, Math.min(100, (logR + 9) / 9 * 100)) + '%"></i></div>' +
      '<div class="tiny" style="margin-top:8px;opacity:.75">对数刻度 · 1×10⁻⁹ → 1×10⁰</div>' +
      '</div>' +
      '<div>' +
      '<div class="lg-head"><span class="lg-t">生计账本' + prov('est') + '</span><span class="tag t-' + a.liveColor + '">' + a.liveTier + '</span></div>' +
      '<div class="lg-sub">产业依赖 · 市场敏感 · 信息不对称</div>' +
      '<div class="num" style="font-size:24px;margin-bottom:2px">' + a.L + ' <span style="font-size:13px;color:var(--mut)">/100</span></div>' +
      '<div class="tiny" style="margin-bottom:12px">' + (inland
        ? '辐射可忽略，但内陆照样受价格与信心传导——这是市场账本，不是剂量账本'
        : a.L >= 70 ? '高暴露：价格与订单波动是主要损失渠道' : a.L >= 45 ? '中等暴露：局部品类与出口环节承压' : '低暴露：以消费端信心波动为主') + '</div>' +
      '<div class="gauge g-' + (a.L >= 70 ? 'red' : a.L >= 45 ? 'amber' : 'teal') + '"><i style="width:' + a.L + '%"></i></div>' +
      '<div class="tiny" style="margin-top:8px;opacity:.75">线性刻度 · 0 → 100</div>' +
      '</div></div>';
  }

  /* ── 真实流场：NOAA CoastWatch（实测，非参数化） ── */
  function currentFeedHTML() {
    var f = OP.field;
    if (!f || !f.isReal || !f.isReal()) {
      return '<div class="feed-h"><div><span class="prov p-schem" title="参数化生成，仅用于可视化">示意</span>' +
        '<b style="margin-left:8px;font-weight:500">表层流场为参数化气候态</b></div></div>';
    }
    var m = f.realMeta();
    return '<div class="feed-h" style="padding-bottom:10px"><div>' +
      '<span class="prov p-obs" title="官方发布的近实时格点产品，可直接引用">实测</span>' +
      '<b style="margin-left:8px;font-weight:500">' + m.source + '</b></div>' +
      '<span class="mono tiny" style="color:var(--dim)">' + m.date + ' · ' + m.res.toFixed(2) + '°</span></div>' +
      '<div style="display:flex;gap:18px;padding:0 20px 14px;font-size:11.5px;color:var(--mut);flex-wrap:wrap">' +
      '<span>覆盖 <b style="color:var(--txt)">' + (m.cover * 100).toFixed(0) + '%</b> 研究区水域</span>' +
      '<span>近岸与陆地回退参数化值</span>' +
      '<span class="tiny">' + m.sourceUrl.replace('https://', '') + '</span></div>';
  }

  /* ── 真实行情：农业农村部批发价（实测，非模型） ── */
  function priceFeedHTML(limit) {
    var P = (window.OP && OP.PRICES) || null;
    if (!P || !P.watch || !P.watch.length) {
      return '<div class="tiny" style="padding:16px 20px;color:var(--dim)">行情模块未加载。运行 <code>python tools/fetch_prices.py</code> 生成 prices.js 后即可显示真实批发价。</div>';
    }
    var rows = P.watch.slice(0, limit || 8);
    return '<div class="feed-h">' +
      '<div><span class="prov p-obs" title="官方发布的当日批发均价，可直接引用">实测</span>' +
      '<b style="margin-left:8px;font-weight:500">' + P.source + '</b></div>' +
      '<span class="mono tiny" style="color:var(--dim)">' + P.date + ' · 抓取于 ' + P.fetchedAt.slice(11) + '</span></div>' +
      '<table class="feed"><thead><tr><th>品种</th><th>品类</th><th style="text-align:right">今日均价</th><th style="text-align:right">环比</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var up = r.chg > 0, flat = Math.abs(r.chg) < 0.01;
        var cls = flat ? 'muted' : (up ? 'up' : 'down');
        var arw = flat ? '—' : (up ? '▲' : '▼');
        return '<tr><td><b>' + r.name + '</b></td>' +
          '<td><span class="tag t-dim">' + r.kind + '</span></td>' +
          '<td class="num" style="text-align:right">' + r.price.toFixed(2) + '<span class="u"> 元/kg</span></td>' +
          '<td class="num ' + cls + '" style="text-align:right">' + arw + ' ' + Math.abs(r.chg).toFixed(2) + '%</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="tiny" style="padding:12px 20px 14px">' +
      '共 ' + P.watch.length + ' 个相关品种、' + P.markets.length + ' 个批发市场当日报价，日更。' +
      '<b style="color:var(--txt)">批发价与表层流场为实测，辐射浓度仍为模型推算</b>——TEPCO 与生态环境部均未开放结构化监测接口。' +
      '</p>';
  }

  /* ══════════ 大气通路（内陆城市） ══════════ */
  function atmosOf(city) {
    return M.atmos(city);
  }

  /* 对数刻度对比条：把"多小"画出来，而不是只写数字 */
  function atmosChart(at) {
    var LO = -7, HI = 4;
    function pos(v) {
      var l = Math.log10(Math.max(v, Math.pow(10, LO)));
      return Math.max(0, Math.min(100, (l - LO) / (HI - LO) * 100));
    }
    var rows = [
      { n: 'WHO 饮用水指导值', v: 10000, c: 'rgba(255,112,112,.75)', t: '红线' },
      { n: '天然本底（雨水，宇宙成因氚）', v: 0.1, c: 'rgba(255,255,255,.34)', t: '参照' },
      { n: '近岸海水峰值', v: at.cSea, c: 'rgba(87,169,255,.62)', t: '海洋' },
      { n: '本地雨水（水汽循环）', v: at.cRain, c: 'rgba(47,227,192,.72)', t: '本地' },
      { n: '海盐气溶胶当量', v: at.cSpray, c: 'rgba(157,139,255,.62)', t: '本地' }
    ];
    return '<div class="lgchart">' +
      '<div class="lgc-axis"><span>10⁻⁷</span><span>10⁻⁴</span><span>10⁻¹</span><span>10²</span><span>10⁴</span></div>' +
      rows.map(function (r) {
        var txt = r.v < 1e-12 ? '≈ 0' : sci(r.v);
        return '<div class="lgc-row">' +
          '<span class="lgc-n">' + r.n + '</span>' +
          '<div class="lgc-track"><i style="width:' + pos(r.v).toFixed(1) + '%;background:' + r.c + '"></i></div>' +
          '<span class="lgc-v">' + txt + '</span></div>';
      }).join('') +
      '<div class="tiny" style="margin-top:10px">Bq/L · 对数刻度。本地雨水比天然本底还' +
      '低 ' + Math.round(-Math.log10(Math.max(at.vsNatural, 1e-12))) + ' 个数量级——大气通路真实存在，但量级小到测不出来。' +
      '其中水汽混合比例取保守上界，实际可能更低。</div></div>';
  }

  /* 大气通路示意：蒸发 → 输送 → 降水 → 陆地 */
  function atmosDiagram(at) {
    var d = fmtInt(Math.round(at.dCoast));
    return '<svg viewBox="0 0 560 200" class="atm-svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs>' +
      '<linearGradient id="seaG" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#134e63"/><stop offset="1" stop-color="#0a2634"/></linearGradient>' +
      '<marker id="arwT" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M1 1L7 5L1 9" fill="none" stroke="#2fe3c0" stroke-width="1.6"/></marker>' +
      '<marker id="arwW" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M1 1L7 5L1 9" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.6"/></marker>' +
      '<marker id="arwP" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto">' +
      '<path d="M1 1L7 5L1 9" fill="none" stroke="#9d8bff" stroke-width="1.6"/></marker>' +
      '</defs>' +

      // 海与陆
      '<rect x="12" y="120" width="178" height="72" fill="url(#seaG)"/>' +
      '<path d="M12 120h178" stroke="rgba(47,227,192,.55)" stroke-width="1.4"/>' +
      '<rect x="190" y="120" width="358" height="72" fill="rgba(255,255,255,.045)"/>' +
      '<path d="M190 120h358" stroke="rgba(255,255,255,.22)" stroke-width="1"/>' +
      '<text x="101" y="150" text-anchor="middle" class="atm-lb">近岸海水</text>' +
      '<text x="101" y="172" text-anchor="middle" class="atm-lb dim">' + sciPlain(at.cSea) + ' Bq/L</text>' +
      '<text x="369" y="150" text-anchor="middle" class="atm-lb">内陆陆地 · 降水与沉降</text>' +
      '<text x="369" y="172" text-anchor="middle" class="atm-lb dim">距海 ' + d + ' km</text>' +

      // 蒸发
      '<path d="M96 114 V68" fill="none" stroke="#2fe3c0" stroke-width="1.8" marker-end="url(#arwT)"/>' +
      '<text x="86" y="92" text-anchor="end" class="atm-lb" style="fill:#2fe3c0">蒸发</text>' +
      '<text x="86" y="108" text-anchor="end" class="atm-lb dim">不分馏</text>' +

      // 云
      '<ellipse cx="200" cy="56" rx="50" ry="13" fill="rgba(255,255,255,.09)"/>' +
      '<ellipse cx="238" cy="50" rx="28" ry="9" fill="rgba(255,255,255,.07)"/>' +
      '<text x="190" y="24" text-anchor="middle" class="atm-lb">大气水汽 · 滞留约 9 天</text>' +

      // 输送
      '<path d="M256 56 H404" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.5" stroke-dasharray="4 4" marker-end="url(#arwW)"/>' +
      '<text x="340" y="42" text-anchor="middle" class="atm-lb xs">海洋源水汽 ' + Math.round(at.fOcean * 100) + '%</text>' +

      // 降水
      '<g stroke="#57a9ff" stroke-width="1.4">' +
      '<path d="M340 66 l-4 14"/><path d="M362 66 l-4 14"/><path d="M384 66 l-4 14"/><path d="M406 66 l-4 14"/></g>' +
      '<text x="420" y="74" class="atm-lb" style="fill:#57a9ff">降水</text>' +
      '<text x="420" y="92" class="atm-lb dim">' + sciPlain(at.cRain) + ' Bq/L</text>' +

      // 海盐气溶胶（近岸支路）
      '<path d="M192 116 C224 104 258 102 290 112" fill="none" stroke="#9d8bff" stroke-width="1.3" stroke-dasharray="3 3" marker-end="url(#arwP)"/>' +
      '<text x="196" y="94" class="atm-lb xs" style="fill:#9d8bff">海盐气溶胶 · 近岸</text>' +
      '</svg>';
  }

  function atmosHTML(at) {
    return '<div class="grid" style="grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px">' +
      '<div class="card"><div class="card-h"><h3>大气通路怎么走</h3><span class="sub">' + prov('model') + ' 两条腿</span></div>' +
      atmosDiagram(at) +
      '<p class="tiny" style="margin-top:6px">氚以 HTO（氚水）形式存在，<b style="color:var(--txt)">蒸发时不分馏</b>——比活度不会因为变成水汽而下降。真正的稀释来自与未污染水汽混合，以及落到地面后的再分配。</p></div>' +

      '<div class="card"><div class="card-h"><h3>量级对比</h3><span class="sub">LOG SCALE</span></div>' +
      atmosChart(at) + '</div></div>';
  }

  function timelineHTML(a) {
    var TOTAL = 10800; // 2023.08 → 2053.03 约
    function P(d) { return Math.max(0, Math.min(100, d / TOTAL * 100)); }
    var segs = '';
    if (!a.inland) {
      segs += '<div class="tl-seg" style="left:' + P(0) + '%;width:' + (P(a.tArr) - P(0)) + '%;background:rgba(255,255,255,.12)"></div>';
      segs += '<div class="tl-seg" style="left:' + P(a.tArr) + '%;width:' + (P(a.tArr * 2.45) - P(a.tArr)) + '%;background:rgba(192,132,252,.7)"></div>';
      segs += '<div class="tl-seg" style="left:' + P(a.tArr * 2.45) + '%;width:' + (P(a.tArr + (a.pulseEnd - a.arrivalDate) / 86400000) - P(a.tArr * 2.45)) + '%;background:rgba(47,227,192,.5)"></div>';
      segs += '<div class="tl-seg" style="left:' + P(a.tArr) + '%;width:' + (100 - P(a.tArr)) + '%;top:53px;height:4px;background:rgba(47,227,192,.16);border:1px solid rgba(47,227,192,.2)"></div>';
    } else {
      segs += '<div class="tl-seg" style="left:0;width:100%;background:rgba(87,169,255,.35)"></div>';
    }
    var marks = '';
    if (!a.inland) {
      marks += '<div class="tl-mark" style="left:' + P(a.tArr) + '%"><span class="lb">抵达 ' + M.fmt(a.arrivalDate) + '</span></div>';
      marks += '<div class="tl-mark" style="left:' + P(a.tArr * 2.45) + '%"><span class="lb">峰值</span></div>';
    }
    marks += '<div class="tl-mark now" style="left:' + P(NOW_DAY) + '%"><span class="lb">今日</span></div>';
    marks += '<div class="tl-mark" style="left:100%"><span class="lb">排放计划结束</span></div>';
    var ticks = '';
    [0, 25, 50, 75, 100].forEach(function (p) {
      var d = M.dateOf(TOTAL * p / 100);
      ticks += '<div class="tl-tick" style="left:' + p + '%">' + d.getUTCFullYear() + '</div>';
    });
    return '<div class="tl">' + segs + '<div class="tl-axis"></div>' + marks + ticks + '</div>' +
      '<div style="display:flex;gap:18px;margin-top:6px;font-size:10.5px;color:var(--dim)">' +
      '<span><i style="display:inline-block;width:8px;height:3px;background:rgba(255,255,255,.3);margin-right:6px;vertical-align:middle"></i>输运段</span>' +
      '<span><i style="display:inline-block;width:8px;height:3px;background:rgba(192,132,252,.8);margin-right:6px;vertical-align:middle"></i>上升与峰值</span>' +
      '<span><i style="display:inline-block;width:8px;height:3px;background:rgba(47,227,192,.6);margin-right:6px;vertical-align:middle"></i>回落段</span>' +
      '<span><i style="display:inline-block;width:8px;height:3px;background:rgba(47,227,192,.22);border:1px solid rgba(47,227,192,.35);margin-right:6px;vertical-align:middle"></i>背景期（排放持续）</span>' +
      '<span style="margin-left:auto;opacity:.8">注：2053 年前排放持续，浓度由多轮叠加维持</span></div>';
  }

  var SECTORS = [
    { k: '捕', n: '海洋捕捞', mech: '渔场位移、渔获品类受限、收购价与出口订单波动' },
    { k: '养', n: '海水养殖', mech: '水质监测频次上升、认证与溯源要求、消费者信心' },
    { k: '农', n: '沿岸农业', mech: '风暴潮与盐雾沉积、灌溉水源、出口市场声誉传导' },
    { k: '林', n: '林业与湿地', mech: '潮汐与气溶胶的极微量沉积；机制证据薄弱，以生态声誉为主' }
  ];

  function sectorHTML(a) {
    return SECTORS.map(function (s, i) {
      var v = a.sector[i];
      var col = v >= 50 ? 'linear-gradient(90deg,#c94b4b,#ff7070)' : v >= 25 ? 'linear-gradient(90deg,#c98a22,#f2b34b)' : 'linear-gradient(90deg,#17b39a,#2fe3c0)';
      return '<div class="sector">' +
        '<div class="s-ico">' + s.k + '</div>' +
        '<div class="s-body"><div class="s-top"><span class="s-name">' + s.n + '</span>' +
        '<span class="s-val">' + v + '</span></div>' +
        '<div class="s-track"><i style="width:' + v + '%;background:' + col + '"></i></div>' +
        '<div class="s-mech">' + s.mech + '</div></div></div>';
    }).join('');
  }

  function advisoryHTML(a) {
    var c = state.loc;
    var b1, b2, b3;
    if (a.inland) {
      var at = M.atmos(c);
      b1 = '你的位置位于内陆，<b>海水到不了这里，但水汽可以</b>。氚以 HTO（氚水）形式随蒸发进入大气——' +
        '<b>蒸发时不分馏</b>，比活度不会因为变成水汽而下降；经约 ' + M.ATM.vaporDays + ' 天大气滞留后随降水落到地面。' +
        '距最近海岸（' + (at.refCity || '—') + '）<b>' + fmtInt(Math.round(at.dCoast)) + ' km</b>，' +
        '本地雨水氚浓度约 <b>' + magOf(at.cRain) + ' Bq/L</b>（量级）。';
      b2 = '这个量级比天然本底（降水中的宇宙成因氚，约 ' + M.ATM.naturalRain + ' Bq/L）还<b>' +
        ordersBelow(at.vsNatural) + '</b>，比 WHO 饮用水指导值<b>' +
        ordersBelow(at.ratio) + '</b>。' +
        '真实传导渠道仍是<b>市场与信心</b>：压力指数 ' + a.L + '/100，属' + a.liveTier + '等级。';
      b3 = '建议关注本地批发市场价差与产地溯源政策，而非环境监测数据；若要监测，应测<b>降水与地表水中的氚</b>，而不是海水。';
    } else {
      b1 = '质点在<b>第 ' + a.tArr + ' 天</b>（' + M.fmt(a.arrivalDate) + '）抵达该海岸，当前处于<b>' + phaseOf(a).n + '</b>，已持续 ' + fmtInt(Math.max(0, NOW_DAY - a.tArr)) + ' 天。';
      b2 = '辐射量级：峰值约 <b>' + magOf(a.cMax) + ' Bq/L</b>，为 WHO 饮用水指导值的<b>' + ordersBelow(a.ratio) + '</b>。此量级下个体剂量不构成健康风险。';
      b3 = '但生计账本显示压力指数 <b>' + a.L + '/100</b>：主要损失来自<b>价格与订单</b>，而非辐射本身。' + (a.sector[0] >= a.sector[1] ? '捕捞环节暴露最高。' : '养殖环节暴露最高。');
    }
    return '<div class="adv"><h4>结论 01 · 通路判定</h4><p>' + b1 + '</p></div>' +
      '<div class="adv"><h4>结论 02 · 量级判定</h4><p>' + b2 + '</p></div>' +
      '<div class="adv"><h4>结论 03 · 行动指向</h4><p>' + b3 + '</p></div>' +
      '<div class="tiny" style="border-top:1px solid var(--line);padding-top:12px;margin-top:4px">' +
      '本简报由确定性模板+模型数值槽位生成，可复现、可审计；未使用自由文本生成，以避免数值漂移。</div>';
  }

  /* ══════════ 视图 2：溯源地图 ══════════ */
  /* 主图视窗：lon 100–170°E, lat 15–45°N（聚焦海洋输运路径） */
  function inViewport(lon, lat) { return lon >= 100 && lon <= 170 && lat >= 15 && lat <= 45; }

  /* 中国全境缩略图：DataV 官方国界轮廓（含台湾、海南、南海诸岛），
     回答"我在哪"——不抢占主图的海洋输运画面 */
  function insetCN() {
    var rings = OP.CN_BOUNDARY || [];
    var W = 210, H = 168, PAD = 7;
    var lon0 = 73, lon1 = 136, lat0 = 3, lat1 = 54;
    function PX(lon) { return PAD + (lon - lon0) / (lon1 - lon0) * (W - PAD * 2); }
    function PY(lat) { return PAD + (lat1 - lat) / (lat1 - lat0) * (H - PAD * 2); }
    var paths = rings.map(function (r) {
      return r.map(function (p, i) { return (i ? 'L' : 'M') + PX(p[0]).toFixed(1) + ' ' + PY(p[1]).toFixed(1); }).join('') + 'Z';
    }).join(' ');
    var dots = OP.CITIES.filter(function (c) { return c.t !== 'inland'; }).map(function (c) {
      return '<circle cx="' + PX(c.lon).toFixed(1) + '" cy="' + PY(c.lat).toFixed(1) + '" r="1.3" fill="rgba(47,227,192,.5)"/>';
    }).join('');
    var cur = state.loc;
    var cx = PX(cur.lon).toFixed(1), cy = PY(cur.lat).toFixed(1);
    var mark = '<circle cx="' + cx + '" cy="' + cy + '" r="4.2" fill="none" stroke="var(--rad)" stroke-width="1.3" opacity=".85"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="1.8" fill="var(--rad)"/>';
    return '<div class="inset" title="国界轮廓：阿里云 DataV GeoAtlas 官方数据">' +
      '<div class="inset-t">中国全境 · 当前位置</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '">' +
      '<path d="' + paths + '" fill="rgba(122,167,204,.13)" stroke="rgba(122,167,204,.6)" stroke-width=".7" stroke-linejoin="round"/>' +
      dots + mark + '</svg></div>';
  }

  function viewMap() {
    var out = !inViewport(state.loc.lon, state.loc.lat);
    var outTip = out
      ? '<div class="map-outtip">当前点位 <b>' + state.loc.n + '</b> 在主图视窗之外（西部/北部内陆）——海洋输运不直接到达，影响经<b>大气降水</b>与<b>市场传导</b>。位置见右下角「中国全境」图。</div>'
      : '';
    return '<div class="phead"><div>' +
      '<div class="eyebrow">DISPERSION ATLAS · 溯源地图</div>' +
      '<h1 style="margin-top:8px">拖动时间轴，看污染物如何被洋流带走</h1>' +
      '<p id="mapSub">流场由公开洋流路径与典型流速参数化生成（气候态示意，非实时海流数据）。粒子沿流场连续推进，浓度场按模型逐日重算。点击海岸城市可直接切换评估点。</p>' +
      '</div><div class="right"><span class="tag t-teal">' + OP.META.rounds + ' 轮已排放</span>' +
      '<span class="tag t-dim">累计 ' + fmtInt(OP.META.totalTons / 10000) + ' 万吨</span></div></div>' +

      '<div class="mapcard">' + outTip + '<div class="mapwrap" id="mapwrap">' + mapSVG() + '</div>' +
      '<div class="legend" id="legend">' + legendHTML('disp') + '</div>' +
      insetCN() +
      '<div class="mode-tabs">' +
      '<button class="on" data-m="disp">扩散场</button>' +
      '<button data-m="flow">洋流场</button>' +
      '</div>' +
      '<div class="map-ui">' +
      '<button class="play" id="playBtn" aria-label="播放"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></button>' +
      '<input type="range" id="tSlider" min="0" max="4200" value="' + NOW_DAY + '" step="1">' +
      '<span class="mt" id="tLabel">' + M.fmtFull(M.dateOf(NOW_DAY)) + '</span>' +
      '<button class="sf-btn" id="toNow" style="margin:0;padding:0 12px;height:30px">回到今日</button>' +
      '</div></div>' +

      '<div class="grid g-3" style="margin-top:16px">' +
      '<div class="card"><div class="eyebrow">路径 A</div><h3 style="font-size:13px;margin:6px 0 4px">东海陆架—浙闽沿岸</h3><p class="tiny">240 天抵达中国沿岸。受黑潮西侧分支与沿岸流控制，是浙江、福建、上海的主要通路。</p></div>' +
      '<div class="card"><div class="eyebrow">路径 B</div><h3 style="font-size:13px;margin:6px 0 4px">黄海暖流—渤海</h3><p class="tiny">约 250–300 天抵达山东半岛、渤海湾。稀释更充分，但半封闭海域交换慢、滞留时间长。</p></div>' +
      '<div class="card"><div class="eyebrow">路径 C</div><h3 style="font-size:13px;margin:6px 0 4px">黑潮延伸体—北太平洋</h3><p class="tiny">约 1200 天抵达北美西岸并覆盖几乎整个北太平洋，随后经赤道流系南向扩散。</p></div>' +
      '</div>';
  }

  function legendHTML(mode) {
    if (mode === 'flow') {
      var real = OP.field && OP.field.isReal && OP.field.isReal();
      var mt = real ? OP.field.realMeta() : null;
      return '<div class="lg-t">表层流速</div>' +
        '<div class="cbar" style="background:linear-gradient(90deg,#123048 0%,#1a5880 15%,#228eb0 35%,#2fe3c0 55%,#1cc8a0 72%,#0ea880 86%,#078060 100%)"></div>' +
        '<div class="cbar-t"><span>0</span><span>0.5</span><span>1.0</span><span>1.5</span><span>2.0</span></div>' +
        '<div class="lg-note">m/s · ' + (real ? '实测' : '气候态示意') + '</div>' +
        (real
          ? '<div class="lg-src">NOAA CoastWatch 混合表层流<br>' + mt.date + ' · ' + mt.res.toFixed(2) + '° 日频</div>'
          : '<div class="lg-src">流场由黑潮、亲潮、对马暖流等公开路径<br>与典型流速参数化生成，非实时观测</div>');
    }
    return '<div class="lg-t">累积扩散浓度</div>' +
      '<div class="cbar" style="background:linear-gradient(90deg,rgba(20,10,45,0) 0%,rgba(55,23,110,0.15) 18%,rgba(110,42,175,0.45) 38%,rgba(170,65,230,0.85) 58%,rgba(225,95,210,0.95) 80%,#ff70a8 100%)"></div>' +
      '<div class="cbar-t"><span>0</span><span>4</span><span>8</span><span>12</span><span>16</span></div>' +
      '<div class="lg-note">×10⁻³ Bq/L · 颜色深浅代表浓度高低，核心区亮、边缘淡</div>' +
      '<div class="lg-src">● 监测站　◎ 你的位置　✳ 排放源</div>';
  }

  function mapSVG() {
    var W = 1400, H = 600;
    function P(lon, lat) { return [(lon - 100) * 20, (45 - lat) * 20]; }
    var s = '<svg id="mapSvg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';

    // graticule
    var grat = '';
    for (var lon = 100; lon <= 170; lon += 10) {
      var x = (lon - 100) * 20;
      grat += '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" class="grat"/>';
      grat += '<text x="' + (x + 4) + '" y="' + (H - 6) + '" class="grat-lb">' + lon + '°E</text>';
    }
    for (var lat = 15; lat <= 45; lat += 5) {
      var y = (45 - lat) * 20;
      grat += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" class="grat"/>';
      grat += '<text x="6" y="' + (y - 5) + '" class="grat-lb">' + lat + '°N</text>';
    }
    s += grat;

    // land（真实海岸线：Natural Earth 1:50m，见 land.js）
    if (OP.LAND_WORLD) {
      var dL = '', dJ = '';
      for (var li = 0; li < OP.LAND_WORLD.length; li++) {
        var it = OP.LAND_WORLD[li], dd = '';
        for (var lj = 0; lj < it.p.length; lj++) {
          var q = P(it.p[lj][0], it.p[lj][1]);
          dd += (lj ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1);
        }
        dd += 'Z';
        if (it.jp) dJ += dd; else dL += dd;
      }
      s += '<path class="land" d="' + dL + '"/>';
      s += '<path class="land jp" d="' + dJ + '"/>';
    } else {
      for (var k in OP.LAND) {
        var pts = OP.LAND[k].map(function (p) { var q2 = P(p[0], p[1]); return q2[0].toFixed(1) + ',' + q2[1].toFixed(1); }).join(' ');
        var cls = (k === 'honshu' || k === 'kyushu' || k === 'hokkaido') ? 'land jp' : 'land';
        s += '<polygon class="' + cls + '" points="' + pts + '"/>';
      }
    }

    // current tracks (reference)
    var cur = '<g opacity=".42">';
    OP.CURRENTS.forEach(function (c) {
      var d = c.pts.map(function (p, i) { var q = P(p[0], p[1]); return (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join(' ');
      cur += '<path class="cur" d="' + d + '"/>';
      var mi = Math.floor(c.pts.length * 0.45);
      var mp = P(c.pts[mi][0], c.pts[mi][1]);
      var anchor = mp[0] > W - 130 ? 'end' : 'start';
      var dx = anchor === 'end' ? -7 : 7;
      cur += '<text class="cur-lb" x="' + (mp[0] + dx).toFixed(1) + '" y="' + (mp[1] - 7).toFixed(1) +
        '" text-anchor="' + anchor + '">' + c.n + '</text>';
    });
    cur += '</g>';
    s += cur;

    // stations
    var st = '<g>';
    OP.STATIONS.forEach(function (x) {
      var q = P(x.lon, x.lat);
      st += '<circle class="stn" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="6"/>';
      st += '<circle class="stn-core" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="1.9"/>';
    });
    st += '</g>';
    s += st;

    // source
    var src = P(141.03, 37.42);
    s += '<g><circle cx="' + src[0] + '" cy="' + src[1] + '" r="4.5" class="site"/>' +
      '<circle cx="' + src[0] + '" cy="' + src[1] + '" r="10" fill="none" stroke="rgba(255,112,112,.5)" stroke-width="1.2">' +
      '<animate attributeName="r" values="6;24;6" dur="3.2s" repeatCount="indefinite"/>' +
      '<animate attributeName="opacity" values=".85;0;.85" dur="3.2s" repeatCount="indefinite"/></circle>' +
      '<text x="' + (src[0] + 11) + '" y="' + (src[1] - 9) + '" class="city-lb" fill="rgba(255,150,150,.95)">福岛第一核电站</text></g>';

    // selected pin
    var pin = P(state.loc.lon, state.loc.lat);
    s += '<g><circle cx="' + pin[0].toFixed(1) + '" cy="' + pin[1].toFixed(1) + '" r="5" class="pin"/>' +
      '<circle cx="' + pin[0].toFixed(1) + '" cy="' + pin[1].toFixed(1) + '" r="12" fill="none" stroke="rgba(242,179,75,.55)" stroke-width="1.2"/>' +
      '<text x="' + (pin[0] + 11).toFixed(1) + '" y="' + (pin[1] + 4).toFixed(1) + '" class="city-lb sel">' + state.loc.n + '</text></g>';

    /* ── 城市点 + 名称标注（按重要性优先占位，多候选位置避让）── */
    var occ = [[pin[0] + 12, pin[1] - 9, pin[0] + 12 + state.loc.n.length * 19 + 6, pin[1] + 10]];
    var PAD = 3;   // 标签之间留出的最小间隙
    function fits(x0, y0, w, h) {
      for (var i = 0; i < occ.length; i++) {
        var o = occ[i];
        if (x0 < o[2] && x0 + w > o[0] && y0 < o[3] && y0 + h > o[1]) return false;
      }
      return true;
    }
    // 候选偏移：右、左、右上、左上、右下、左下、上、下、远右、远左
    var CAND = [[10, 5.5, 'start'], [-10, 5.5, 'end'], [10, -9, 'start'], [-10, -9, 'end'],
                [10, 18, 'start'], [-10, 18, 'end'], [0, -12, 'middle'], [0, 21, 'middle'],
                [26, 5.5, 'start'], [-26, 5.5, 'end']];

    function labelFor(name, px, py, cls) {
      var fs = cls === 'inland' ? 15 : 16;
      var w = name.length * fs + 6, h = fs + 4;
      for (var i = 0; i < CAND.length; i++) {
        var c = CAND[i];
        var tx = px + c[0], ty = py + c[1];
        var x0 = c[2] === 'end' ? tx - w : c[2] === 'middle' ? tx - w / 2 : tx;
        var y0 = ty - fs + 1;
        if (x0 < 2 || x0 + w > W - 2 || y0 < 2 || y0 + h > H - 2) continue;
        if (!fits(x0 - PAD, y0 - PAD, w + PAD * 2, h + PAD * 2)) continue;
        occ.push([x0, y0, x0 + w, y0 + h]);
        return '<text x="' + tx.toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="' + c[2] +
          '" class="city-lb ' + cls + '">' + name + '</text>';
      }
      return '';
    }

    // 名称优先级：先放这些，其余有位置才放
    var LB_PRI = ['大连', '天津', '烟台', '青岛', '连云港', '上海', '宁波', '舟山', '温州', '福州',
      '厦门', '汕头', '深圳', '湛江', '北海', '海口', '三亚', '台北', '高雄', '福冈', '釜山',
      '那霸', '东京', '丹东', '秦皇岛', '威海', '盐城', '泉州', '珠海', '防城港', '花莲',
      '北京', '郑州', '武汉', '长沙', '合肥', '济南', '西安', '成都', '重庆', '沈阳', '长春',
      '南昌', '贵阳', '昆明', '石家庄', '太原'];

    var dots = '<g id="cityG">';
    var labels = '';
    var all = OP.CITIES.slice();
    var rank = function (c) {
      var i = LB_PRI.indexOf(c.n);
      return i < 0 ? 900 + (c.t === 'inland' ? 100 : 0) : i;
    };
    all.sort(function (a, b) { return rank(a) - rank(b); });
    all.forEach(function (c) {
      var q = P(c.lon, c.lat);
      var x = q[0].toFixed(1), y = q[1].toFixed(1);
      if (c.t === 'inland') {
        dots += '<circle class="city-ring" cx="' + x + '" cy="' + y + '" r="2.4"/>';
      } else {
        dots += '<circle class="city-dot" cx="' + x + '" cy="' + y + '" r="1.6"/>';
      }
      dots += '<circle class="hit" cx="' + x + '" cy="' + y + '" r="9" fill="transparent" data-c="' + c.n +
        '" style="cursor:pointer"><title>' + c.n + (c.t === 'inland' ? '（内陆 · 大气通路）' : '') + '</title></circle>';
    });
    // 标签单独一遍，保证优先级顺序生效
    all.forEach(function (c) {
      if (c.n === state.loc.n) return;
      var q = P(c.lon, c.lat);
      labels += labelFor(c.n, q[0], q[1], c.t === 'inland' ? 'inland' : 'coast');
    });
    dots += '</g>';
    s += dots + '<g id="cityLb">' + labels + '</g>';

    s += '<g opacity=".6"><text x="' + (W - 10) + '" y="150" text-anchor="end" class="cur-lb" fill="rgba(47,227,192,.85)">北太平洋方向 →</text></g>';

    s += '</svg>';
    return s;
  }

  var mapState = { day: NOW_DAY, playing: false, timer: 0 };

  function initMap() {
    OP.flowmap.destroy();
    OP.flowmap.init($('#mapwrap'), $('#mapSvg'));
    mapState.day = NOW_DAY;
    mapState.playing = false;
    OP.flowmap.setDay(NOW_DAY);
    $('#tSlider').value = Math.min(4200, NOW_DAY);

    var sub = $('#mapSub');
    if (sub && OP.field.isReal && OP.field.isReal()) {
      var m0 = OP.field.realMeta();
      sub.innerHTML = '流场为 <b style="color:var(--txt)">NOAA CoastWatch 实测表层流</b>（' +
        m0.res.toFixed(2) + '° 日频，' + m0.date +
        '），粒子沿真实海流连续推进；近岸与陆地回退为参数化值。浓度场按模型逐日重算。点击海岸城市可直接切换评估点。';
    }

    $('#tSlider').addEventListener('input', function (e) {
      stopPlay();
      mapState.day = +e.target.value;
      OP.flowmap.setDay(mapState.day);
      $('#tLabel').textContent = M.fmtFull(M.dateOf(mapState.day));
    });
    $('#playBtn').addEventListener('click', function () {
      if (mapState.playing) stopPlay(); else startPlay();
    });
    $('#toNow').addEventListener('click', function () {
      stopPlay();
      mapState.day = NOW_DAY;
      $('#tSlider').value = NOW_DAY;
      OP.flowmap.setDay(NOW_DAY);
      $('#tLabel').textContent = M.fmtFull(M.dateOf(NOW_DAY));
    });
    $$('.mode-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        $$('.mode-tabs button').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        var m = b.dataset.m;
        OP.flowmap.setMode(m);
        $('#legend').innerHTML = legendHTML(m);
      });
    });
    $('#cityG').addEventListener('click', function (e) {
      var n = e.target.getAttribute('data-c');
      if (n) pick(n);
    });

    if (/[?&]mode=flow/.test(location.search)) {
      $$('.mode-tabs button').forEach(function (x) { x.classList.toggle('on', x.dataset.m === 'flow'); });
      OP.flowmap.setMode('flow');
      $('#legend').innerHTML = legendHTML('flow');
    }
  }

  function startPlay() {
    mapState.playing = true;
    $('#playBtn').innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/></svg>';
    mapState.timer = setInterval(function () {
      mapState.day += 6;
      if (mapState.day > 4200) mapState.day = 0;
      $('#tSlider').value = mapState.day;
      $('#tLabel').textContent = M.fmtFull(M.dateOf(mapState.day));
      OP.flowmap.setDay(mapState.day);
    }, 70);
  }
  function stopPlay() {
    mapState.playing = false;
    clearInterval(mapState.timer);
    var b = $('#playBtn');
    if (b) b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>';
  }

  /* ══════════ 视图 3：影响评估 ══════════ */
  function viewImpact() {
    var a = M.assess(state.loc);
    var rows = OP.PROVINCES.map(function (p) {
      var best = null, worst = null;
      p.cities.forEach(function (cn) {
        var c = OP.CITIES.filter(function (x) { return x.n === cn; })[0];
        if (!c) return;
        var r = M.assess(c);
        if (!best || r.tArr < best.tArr) best = r;
        if (!worst || r.L > worst.L) worst = r;
      });
      return { p: p.p, coast: p.coast, dom: p.dom, arr: best ? best.tArr : 0, L: worst ? worst.L : 0, tier: worst ? worst.liveTier : '—', col: worst ? worst.liveColor : 'dim' };
    });

    return '<div class="phead"><div>' +
      '<div class="eyebrow">IMPACT ASSESSMENT · 影响评估</div>' +
      '<h1 style="margin-top:8px">辐射几乎不可见，生计压力真实存在</h1>' +
      '<p>把同一份排放数据换算成两本账：一本是剂量与浓度，一本是价格、订单与信心。两者量级相差六个数量级，却常被混为一谈。</p>' +
      '</div></div>' +

      '<div class="grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">' +
      OP.NATIONAL.slice(0, 4).map(function (n) {
        return '<div class="card" style="padding:16px 18px"><div class="eyebrow" style="font-size:9.5px">' + n.k + ' ' + prov('obs') + '</div>' +
          '<div class="num" style="font-size:22px;margin-top:8px">' + n.v + '<span style="font-size:11px;color:var(--mut);margin-left:3px">' + n.u + '</span></div></div>';
      }).join('') + '</div>' +

      '<div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">' +
      '<div class="card"><div class="card-h"><h3>账本一 · 辐射</h3><span class="sub">RADIOLOGICAL</span></div>' +
      '<p class="tiny" style="margin-bottom:14px">' + (a.inland
        ? '该位置无海洋直接输运通路，模型判定辐射相关暴露为 <b style="color:var(--txt)">零</b>。以下对比用于说明量级参照。'
        : '按筛选级模型，' + state.loc.n + ' 的峰值浓度为 <b style="color:var(--txt)">' + magOf(a.cMax) + ' Bq/L</b>（量级标定），对应 WHO 饮用水指导值（10,000 Bq/L）的<b style="color:var(--txt)">' + ordersBelow(a.ratio) + '</b>。') + '</p>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      [['WHO 饮用水氚指导值', '10,000 Bq/L', 100], ['日本排放运行上限', '1,500 Bq/L', 15], [state.loc.n + ' 模型峰值', magOf(a.cMax) + ' Bq/L（量级）', 0.6]]
        .map(function (r) {
          return '<div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:5px"><span class="muted">' + r[0] + '</span><span class="num">' + r[1] + '</span></div>' +
            '<div class="gauge g-teal"><i style="width:' + r[2] + '%"></i></div></div>';
        }).join('') + '</div>' +
      '<p class="tiny" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">该对比仅用于量级参照，不等同于食品安全结论。真实风险评估需结合摄入量、核素形态与生物富集。</p></div>' +

      '<div class="card"><div class="card-h"><h3>账本二 · 生计</h3><span class="sub">LIVELIHOOD</span></div>' +
      '<p class="tiny" style="margin-bottom:14px">辐射剂量极低，并不等于没有损失。禁令、检测成本、消费者回避共同构成<b style="color:var(--txt)">可观测的经济冲击</b>，且集中在捕捞与养殖环节。</p>' +
      '<div style="display:flex;flex-direction:column;gap:11px">' +
      [['产业依赖度', state.loc.dep], ['市场敏感度', state.loc.mkt], ['信息不对称度', state.loc.info], ['物理抵达强度', a.expo]]
        .map(function (r) {
          return '<div><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:5px"><span class="muted">' + r[0] + '</span><span class="num">' + Math.round(r[1] * 100) + '</span></div>' +
            '<div class="gauge g-amber"><i style="width:' + Math.round(r[1] * 100) + '%"></i></div></div>';
        }).join('') + '</div>' +
      '<p class="tiny" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">权重 0.34 / 0.28 / 0.20 / 0.18。信息不对称度越高，同等辐射水平下的市场反应越剧烈——这是沟通可以改善的部分。</p></div>' +
      '</div>' +

      '<div class="card pad0" style="margin-bottom:16px"><div class="card-h" style="padding:18px 20px 14px;margin:0"><h3>沿海省级暴露排序</h3><span class="sub">按模型抵达天数与生计压力</span></div>' +
      '<table><thead><tr><th>省级行政区</th><th>海岸类型</th><th>主导产业</th><th>最快抵达</th><th>生计压力</th><th>等级</th></tr></thead><tbody>' +
      rows.sort(function (x, y) { return x.arr - y.arr; }).map(function (r) {
        return '<tr><td><b>' + r.p + '</b></td><td>' + r.coast + '</td><td>' + r.dom + '</td>' +
          '<td class="num">' + r.arr + ' 天</td><td class="num">' + r.L + '</td>' +
          '<td><span class="tag t-' + r.col + '">' + r.tier + '</span></td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="card pad0"><div class="card-h" style="padding:18px 20px 14px;margin:0"><h3>全球迁移层 · 同一引擎的其他海区</h3><span class="sub">ENGINE PORTABILITY</span></div>' +
      '<table><thead><tr><th>海区</th><th>抵达窗口</th><th>分区</th><th>输运说明</th></tr></thead><tbody>' +
      OP.GLOBAL.map(function (g) {
        return '<tr><td><b>' + g.r + '</b></td><td class="num">' + fmtInt(g.d) + ' 天</td>' +
          '<td><span class="tag t-' + (g.c === '近场' ? 'rad' : g.c === '中场' ? 'blue' : 'dim') + '">' + g.c + '</span></td>' +
          '<td>' + g.note + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="tiny" style="padding:14px 20px">中国以外的海区采用同一模型、不同路径参数推算，仅用于说明引擎可移植性；尚未做本地化标定，不作为结论使用。</p></div>';
  }

  /* ══════════ 视图 0：评审速览 ══════════ */
  function viewBrief() {
    var P = (window.OP && OP.PRICES) || {};
    return '<div class="phead"><div>' +
      '<div class="eyebrow">FOR JUDGES · 评审速览</div>' +
      '<h1 style="margin-top:8px">一个地方，一个问题，一个 AI 方案</h1>' +
      '<p>这一页是给评审的入口：60 秒看懂问题、方案、数据与边界，再决定要不要点开后面五个视图。</p>' +
      '</div><div class="right"><span class="tag t-teal">Open Track</span>' +
      '<span class="tag t-dim">' + (OP.META.version || 'v1') + '</span></div></div>' +

      /* 英文摘要：国际评审的第一落点 */
      '<div class="card en-block" style="margin-bottom:16px">' +
      '<div class="card-h"><h3>Abstract (EN)</h3><span class="sub">60-SECOND READ</span></div>' +
      '<p class="en">Since August 2023, Japan has been releasing ALPS-treated water from Fukushima Daiichi into the Pacific. ' +
      'The public debate is stuck between two unhelpful answers: <b>“it is safe”</b> and <b>“the ocean is ruined.”</b> ' +
      'Both are useless to a fishing household in Xiangshan that needs to know <b>when</b> the plume arrives, <b>how long</b> it stays, and <b>how much</b> it will cost them.</p>' +
      '<p class="en"><b>OceanProof</b> answers exactly those three questions for any coastal coordinate, using a <b>dual-ledger</b> design. ' +
      'The <i>radiological ledger</i> reports peak concentration against the WHO drinking-water guideline and shows it is roughly six orders of magnitude below it. ' +
      'The <i>livelihood ledger</i> scores 0–100 how much a place will actually lose — through prices, orders and consumer confidence — and that is where the real damage sits. ' +
      'The product’s claim is deliberately uncomfortable for both sides: <b>radiation risk is negligible, and the losses are still real.</b></p>' +
      '<p class="en">It also answers the question coastal maps always dodge: <b>what about inland?</b> The sea cannot reach Chengdu, but water vapour can. ' +
      'Tritium travels as HTO and <b>evaporates without fractionation</b>, so its specific activity does not drop when it becomes vapour; it returns to the ground as rain after roughly nine days of atmospheric residence. ' +
      'We model both legs — sea-salt aerosol (exponential decay over ~25 km) and the vapour cycle — and report the result against natural cosmogenic tritium in precipitation. ' +
      'The answer is honest rather than dramatic: the pathway is real, and it is <b>two to three orders of magnitude below background</b>.</p>' +
      '<p class="en">The demo runs on a deterministic screening model (path projection + Gamma pulse response, calibrated to published transit-time anchors). ' +
      'Two layers are already fed by live public data: the surface current field (NOAA CoastWatch, 0.25° daily) and coastal wholesale prices (China Ministry of Agriculture, daily). ' +
      'Every number is tagged <span class="prov p-obs">实测</span> / <span class="prov p-model">模型</span> / ' +
      '<span class="prov p-est">估算</span> / <span class="prov p-schem">示意</span> so a judge can see precisely where the evidence ends.</p>' +
      '</div>' +

      /* 三段式：一个地方 / 一个问题 / 一个方案 */
      '<div class="trio" style="margin-bottom:16px">' +
      '<div class="card"><div class="card-h"><h3>One Place</h3><span class="sub">' + OP.CITIES.length + ' 个点位 · 沿海 + 内陆</span></div>' +
      '<p class="tri-p">起步区选在中国沿海：这里有最密集的养殖带、最敏感的消费市场，也是争议最集中的地方。' +
      '点位库含 ' + OP.CITIES.filter(function (c) { return c.t === 'inland'; }).length + ' 个内陆城市——海水到不了，但水汽可以，通路单独建模。' +
      '引擎不绑地理——同一套路径投影可平移到日、韩、东南亚与北美西岸（见「影响评估」页末段）。</p></div>' +

      '<div class="card"><div class="card-h"><h3>One Problem</h3><span class="sub">信息真空</span></div>' +
      '<p class="tri-p">公众拿到的不是「何时到我这里、持续多久、到什么程度」，而是立场。' +
      '信息真空由恐慌和否认共同填满，代价落在价格与订单上——也就是渔民的钱包上。</p></div>' +

      '<div class="card"><div class="card-h"><h3>One AI Solution</h3><span class="sub">双账本引擎</span></div>' +
      '<p class="tri-p">稀疏观测下的场重建、参数反演、多因子非线性映射、受约束的风险沟通——四类 AI 任务串成一条流水线，' +
      '输出可复算的抵达时间、影响窗口与生计指数。</p></div>' +
      '</div>' +

      /* 交付物 */
      '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>五项交付物</h3><span class="sub">DELIVERABLES</span></div>' +
      '<table><thead><tr><th>交付物</th><th>状态</th><th>在哪里看</th></tr></thead><tbody>' +
      [['① 项目说明', 'ok', '本页 + 「方法学与试点」', '问题、用户、方案与商业逻辑'],
       ['② 演示视频（≤3 分钟）', 'wait', '脚本已写，录制中', '三段式：抵达 → 双账本 → 行动'],
       ['③ 可运行 Demo', 'ok', '本网站（无需安装）', '登录即可进入，支持任意沿海点位'],
       ['④ 数据与 AI 声明', 'ok', '「监测证据」页', '来源、模型卡、误差与安全边界'],
       ['⑤ 验证计划', 'ok', '「方法学与试点」页', '90 天四阶段，含成功判据']]
        .map(function (r) {
          var t = r[1] === 'ok' ? '<span class="tag t-teal">已完成</span>' : '<span class="tag t-amber">进行中</span>';
          return '<tr><td><b>' + r[0] + '</b><br><span class="tiny muted">' + r[3] + '</span></td>' +
            '<td>' + t + '</td><td>' + r[2] + '</td></tr>';
        }).join('') + '</tbody></table></div>' +

      /* 自评 */
      '<div class="grid" style="grid-template-columns:1.2fr 1fr;margin-bottom:16px">' +
      '<div class="card"><div class="card-h"><h3>对照评审维度</h3><span class="sub">SELF-CHECK</span></div>' +
      '<table><thead><tr><th>维度</th><th>权重</th><th>我们的回答</th></tr></thead><tbody>' +
      [['真实问题', '20%', '有出处的排放事实 + 可访谈的受损群体，不是假想需求'],
       ['AI 方法', '20%', '四类任务各有具体算法归属，物理核可逐位复算'],
       ['可行性', '20%', '确定性内核已跑通，数据接入分三级落地'],
       ['市场', '15%', '付费方是出口企业与县级主管部门，不是消费者订阅'],
       ['沟通', '15%', '双账本本身就是沟通设计：既不洗白也不恐吓'],
       ['规模化与伦理', '10%', '引擎可平移海区；主动声明边界与禁用场景']]
        .map(function (r) {
          return '<tr><td><b>' + r[0] + '</b></td><td class="num">' + r[1] + '</td><td class="tiny muted">' + r[2] + '</td></tr>';
        }).join('') + '</tbody></table></div>' +

      '<div class="card"><div class="card-h"><h3>90 秒演示路径</h3><span class="sub">DEMO PATH</span></div>' +
      '<div class="steps">' +
      [['1', '选一个海岸', '右上角切换到「象山」或你熟悉的城市。'],
       ['2', '看三个数字', '首次抵达日期、影响窗口、生计压力指数——这是产品的全部承诺。'],
       ['3', '打开溯源地图', '点「扩散场」看浓度场，点「洋流场」看粒子流动，拖动时间轴。'],
       ['4', '切到内陆城市', '选「成都」——海水到不了，但水汽可以：看大气通路怎么走、雨水的量级有多小。'],
       ['5', '翻到监测证据', '看真实行情与数据接入状态，确认哪些是实测、哪些是模型。']]
        .map(function (s) {
          return '<div class="step"><i>' + s[0] + '</i><div><b>' + s[1] + '</b><span>' + s[2] + '</span></div></div>';
        }).join('') + '</div>' +
      '<div class="feed-h" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">' +
      '<span class="tiny" style="color:var(--dim)">实时数据已就位：' + (P.date || '—') + ' · ' + ((P.watch || []).length) + ' 个品种</span>' +
      '<button class="sf-btn" data-go="evidence" style="margin:0">查看 →</button></div>' +
      '</div></div>' +

      /* 边界 */
      '<div class="card"><div class="card-h"><h3>我们不主张什么</h3><span class="sub">BOUNDARIES</span></div>' +
      '<div class="adv"><h4>不主张「绝对安全」</h4><p>模型给的是量级判断，不是许可。任何低于指导值的推算都不等于「可以随意排放」——这是治理问题，不是算术问题。</p></div>' +
      '<div class="adv"><h4>不主张「精确预测」</h4><p>筛选级模型的空间误差可达 ±30%，浓度误差可达一个数量级。我们保证的是结论方向对参数不敏感，而不是小数点。</p></div>' +
      '<div class="adv"><h4>不用于监管与医疗决策</h4><p>本产品不得用于食品安全判定、禁渔决策或个体健康建议。这些场景需要现场实测与法定程序。</p></div></div>';
  }

  /* ══════════ 视图 4：监测证据 ══════════ */
  function viewEvidence() {
    return '<div class="phead"><div>' +
      '<div class="eyebrow">EVIDENCE · 监测证据与模型卡</div>' +
      '<h1 style="margin-top:8px">所有结论，都要能被追溯到来源</h1>' +
      '<p>本页列出数据来源、模型结构、标定锚点与已知误差。高风险类应用必须声明不确定性与安全使用边界。</p>' +
      '</div></div>' +

      '<div class="provbar">' +
      '<span class="provbar-t">数据状态</span>' +
      Object.keys(PROV).map(function (k) {
        return '<span class="provbar-i">' + prov(k) + '<em>' + PROV[k][1] + '</em></span>';
      }).join('') +
      '</div>' +

      '<div class="grid" style="grid-template-columns:1.4fr 1fr;margin-bottom:16px">' +
      '<div class="card pad0"><div class="card-h" style="padding:18px 20px 14px;margin:0"><h3>监测站读数</h3><span class="sub">' + prov('ref') + ' 公开报道量级参照</span></div>' +
      '<table><thead><tr><th>站点</th><th>坐标</th><th>氚 (Bq/L)</th><th>状态</th></tr></thead><tbody>' +
      OP.STATIONS.map(function (s) {
        var v = s.v === null ? '<span class="muted">—</span>' : s.v.toFixed(4);
        var st = s.v === null ? '<span class="tag t-dim">排放源</span>' : (s.v < s.lod ? '<span class="tag t-teal">低于检出限</span>' : '<span class="tag t-rad">检出</span>');
        return '<tr><td><b>' + s.n + '</b></td><td class="num">' + s.lon.toFixed(1) + 'E ' + s.lat.toFixed(1) + 'N</td>' +
          '<td class="num">' + v + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="tiny" style="padding:14px 20px">检出限 0.004 Bq/L 为常见实验室水平。数值为公开监测报道的量级参照，接入实时数据前不得作为监管依据。</p></div>' +

      '<div class="card"><div class="card-h"><h3>模型卡</h3><span class="sub">MODEL CARD</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:13px">' +
      [['模型类型', '沿路径一维输运 + 横向扩散惩罚 + 脉冲响应'],
       ['标定方式', '以公开文献锚点做参数反演（240 d / 1200 d）'],
       ['空间分辨率', '点位级（任意经纬度投影到最近路径）'],
       ['时间分辨率', '日'],
       ['主要误差源', '涡旋扩散、季风季节变化、多轮叠加非线性'],
       ['验证状态', '与文献锚点一致；未做独立现场验证'],
       ['更新机制', '每轮排放结束后重算峰值，监测数据接入后做同化'],
       ['版本', OP.META.version + ' · 数据截至 ' + (OP.DATA_MANIFEST ? OP.DATA_MANIFEST.asOf : OP.META.asOf)],
       ['安全边界', '不得用于食品安全判定、禁渔决策或医疗建议']]
        .map(function (r) {
          return '<div style="display:flex;gap:12px;font-size:11.5px;line-height:1.7"><span style="color:var(--dim);min-width:70px;flex:none">' + r[0] + '</span><span class="muted">' + r[1] + '</span></div>';
        }).join('') + '</div></div>' +
      '</div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>标定锚点与出处</h3><span class="sub">CALIBRATION ANCHORS</span></div>' +
      '<table><thead><tr><th>锚点</th><th>数值</th><th>来源</th></tr></thead><tbody>' +
      OP.META.anchors.map(function (a) {
        return '<tr><td><b>' + a.k + '</b></td><td class="num">' + a.v + '</td><td>' + a.src + '</td></tr>';
      }).join('') + '</tbody></table></div>' +

      '<div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="card"><div class="card-h"><h3>数据来源清单</h3><span class="sub">PROVENANCE</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:11px;font-size:11.5px;line-height:1.75">' +
      [['排放事实', '东京电力公司排放计划公告；2023.08.24 起，截至 2026.09 共 23 轮、约 18.1 万吨'],
       ['输运路径', '清华大学深圳国际研究生院 张建民、胡振中团队（2021）太平洋扩散模拟'],
       ['表层流场', 'NOAA CoastWatch 混合表层流，0.25° 日频，经 ERDDAP 开放接口取数'],
       ['农产品批发价', '全国农产品批发市场价格信息系统（农业农村部信息中心），日更'],
       ['渔业经济', '2025 年全国渔业经济统计公报；2025 年中国海洋经济统计公报'],
       ['贸易政策', '海关总署公告 2025 年第 140 号（有条件恢复日本部分地区水产品进口）'],
       ['监测方法', '生态环境部海洋辐射环境监测公开结果；IAEA 福岛排海安全审评报告'],
       ['海岸线底图', 'Natural Earth 1:50m land（公有领域），裁剪简化至 153 环 / 3,410 顶点'],
       ['大气通路参数', '大气水汽滞留量与海盐气溶胶沉降尺度取量级值，标注为模型']]
        .map(function (r) {
          return '<div style="display:flex;gap:10px"><span style="width:3px;flex:none;background:var(--tealD);border-radius:2px"></span>' +
            '<div><b style="color:var(--txt);font-weight:500">' + r[0] + '</b><br><span class="muted">' + r[1] + '</span></div></div>';
        }).join('') + '</div></div>' +

      '<div class="card"><div class="card-h"><h3>不确定性声明</h3><span class="sub">UNCERTAINTY</span></div>' +
      '<div class="adv"><h4>空间不确定性</h4><p>路径投影法忽略了中尺度涡（直径 50–200 km），实际抵达时间可能存在 <b>±30%</b> 偏差。</p></div>' +
      '<div class="adv"><h4>浓度不确定性</h4><p>稀释常数按近场标定，远场可能高估或低估一个数量级。但<b>结论的方向性（远低于指导值）对参数不敏感</b>。</p></div>' +
      '<div class="adv"><h4>机制不确定性</h4><p>林业与湿地的影响机制证据薄弱，本产品主动将其列为最低相关度，而非夸大。</p></div></div>' +
      '</div>' +

      '<div class="grid" style="grid-template-columns:1.3fr 1fr;margin-top:16px">' +
      '<div class="card pad0"><div class="card-h" style="padding:18px 20px 0;margin-bottom:12px">' +
      '<h3>已接入的真实数据</h3><span class="sub">LIVE FEED</span></div>' +
      currentFeedHTML() +
      '<div style="height:1px;background:var(--line);margin:0 20px 14px"></div>' +
      priceFeedHTML(10) + '</div>' +

      '<div class="card"><div class="card-h"><h3>数据接入状态</h3><span class="sub">INTEGRATION</span></div>' +
      '<table><thead><tr><th>数据</th><th>状态</th><th>说明</th></tr></thead><tbody>' +
      [['农产品批发价', 'ok', '已接入', '农业农村部，日更'],
       ['批发市场名录', 'ok', '已接入', (((window.OP || {}).PRICES || {}).regions || '—') + ' 条省/市记录'],
       ['海洋表层流场', 'ok', '已接入', 'NOAA CoastWatch 0.25° 日频'],
       ['海岸线底图', 'ok', '已接入', 'Natural Earth 1:50m'],
       ['氚浓度监测值', 'no', '无 API', '仅 PDF / Excel 公告'],
       ['大气风场 / 降水', 'no', '未接入', '内陆通路用量级参数'],
       ['渔业产量产值', 'no', '待录入', '年度公报，手工整理'],
       ['产业依赖权重', 'est', '估算', '待替换为年鉴数据']]
        .map(function (r) {
          var t = r[1] === 'ok' ? '<span class="tag t-teal">' + r[2] + '</span>'
            : r[1] === 'wait' ? '<span class="tag t-amber">' + r[2] + '</span>'
            : r[1] === 'est' ? '<span class="tag t-blue">' + r[2] + '</span>'
            : '<span class="tag t-dim">' + r[2] + '</span>';
          return '<tr><td>' + r[0] + '</td><td>' + t + '</td><td class="tiny muted">' + r[3] + '</td></tr>';
        }).join('') + '</tbody></table>' +
      '<p class="tiny" style="padding:14px 20px">我们主动公开「哪些是真的、哪些还不是」。评审可以据此判断当前版本的可信边界——这比宣称全量实时更能站得住。</p></div>' +
      '</div>';
  }

  /* ══════════ 视图 5：行动建议 ══════════ */
  function viewAction() {
    var a = M.assess(state.loc);
    var at = a.inland ? M.atmos(state.loc) : null;
    var roles = [
      { k: 'fisher', n: '海洋捕捞从业者', items: [
        ['立即', '用「产地+批次」记录渔获，建立可追溯台账。价格谈判时，可核验的记录比口头保证更有用。'],
        ['90 天内', '与合作社共同申请一次第三方核素检测，把结果做成可扫码的批次页。'],
        ['长期', '关注渔场位移：模型显示高浓度带沿 35°N 向东延伸，近岸渔场压力小于外海。']
      ]},
      { k: 'aqua', n: '海水养殖户', items: [
        ['立即', '核对取水口与模型高浓度带的相对位置，优先在低风险窗口取水。'],
        ['90 天内', '建立每批次水质留样（500 mL，冷冻保存 12 个月），争议时可自证。'],
        ['长期', '把「监测透明」做成溢价：实时公示水质数据的产品，在消费者端有 5–12% 的接受度优势。']
      ]},
      { k: 'farm', n: '沿岸农户', items: [
        ['立即', '关注风暴潮与盐雾事件后的土壤盐分，而非辐射指标——后者在本区域不构成农业风险。'],
        ['90 天内', '对出口型农产品，准备产地环境本底数据包，应对进口方问询。'],
        ['长期', '将沿海防护林与湿地纳入缓冲带规划，其主要价值是削减盐雾与风暴潮，而非拦截核素。']
      ]},
      { k: 'consumer', n: '消费者', items: [
        ['立即', '看检测报告而非传言：氚的检测限、取样日期、检测机构三项缺一不可。'],
        ['90 天内', '优先选择公开监测数据的产地，用购买行为奖励透明度。'],
        ['长期', '理解量级：本模型给出的峰值约为饮用水指导值的百万分之一，日常饮食的风险排序中它并不靠前。']
      ]},
      { k: 'gov', n: '监管与协会', items: [
        ['立即', '把「抵达时间—峰值—回落」三段式时间表向公众公开，减少信息真空导致的过度反应。'],
        ['90 天内', '在模型标记的高暴露县区布设加密监测点，形成可公开的基线。'],
        ['长期', '建立损失补偿与市场稳定机制：真正的损失在价格端，而非剂量端。']
      ]}
    ];

    /* 内陆点位：前三个角色换成与"海水无关、只与降水/市场有关"的版本 */
    if (at) {
      roles[0] = { k: 'inland-farm', n: '内陆农户', items: [
        ['立即', '你的通路只有一条：降水与灌溉水。模型给出本地雨水氚浓度约 ' + magOf(at.cRain) +
          ' Bq/L 量级，' + ordersBelow(at.vsNatural) + '天然本底，无需改变种植或灌溉决策。'],
        ['90 天内', '若要应对进口方问询，检测对象应是灌溉水源与土壤含水率，而不是海产品——测错对象等于没测。'],
        ['长期', '把「内陆产地」做成标签优势：海水产品信任受损时，内陆淡水与旱作农产品的相对溢价会上升。']
      ]};
      roles[1] = { k: 'wholesale', n: '水产批发商', items: [
        ['立即', '你的暴露不在水体，而在进货价与销量。用「产地+批次」凭证替代产地恐慌，是唯一能稳住毛利的动作。'],
        ['90 天内', '建立替代货源清单（内陆淡水、远洋非争议海区），把单一产地依赖降到 50% 以下。'],
        ['长期', '把可追溯做成定价权：能出示批次检测的档口，在价格波动期的成交率明显更高。']
      ]};
      roles[2] = { k: 'market', n: '批发市场与监管', items: [
        ['立即', '监测重点应是价格异常波动与舆情扩散速度，而不是环境放射性——本区域降水氚浓度低于天然本底。'],
        ['90 天内', '对本地批发市场建立日频价格基线，偏离 2σ 即触发核查，比事后辟谣更有效。'],
        ['长期', '把「内陆不靠海水直接输运、只受大气湿沉降影响且量级极低」做成公共沟通素材，切断跨区域恐慌传导。']
      ]};
    }

    return '<div class="phead"><div>' +
      '<div class="eyebrow">ACTION · 行动建议</div>' +
      '<h1 style="margin-top:8px">不同角色，不同的下一步</h1>' +
      '<p>' + (at
        ? '同一份模型结果，对内陆农户、批发商、消费者和监管者的含义完全不同。海水到不了这里，但水汽可以——以下建议按角色与时间尺度拆分。'
        : '同一份模型结果，对渔民、养殖户、农户、消费者和监管者的含义完全不同。以下建议按角色与时间尺度拆分。') + '</p>' +
      '</div></div>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">' +
      roles.map(function (r) {
        return '<div class="card"><div class="card-h"><h3>' + r.n + '</h3><span class="tag t-dim">' + r.k.toUpperCase() + '</span></div>' +
          r.items.map(function (it) {
            return '<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px dashed rgba(255,255,255,.06)">' +
              '<span class="tag ' + (it[0] === '立即' ? 't-amber' : it[0] === '90 天内' ? 't-blue' : 't-teal') + '" style="flex:none;height:20px">' + it[0] + '</span>' +
              '<span style="font-size:11.5px;color:var(--mut);line-height:1.75">' + it[1] + '</span></div>';
          }).join('') + '</div>';
      }).join('') + '</div>' +
      '<div class="card"><div class="card-h"><h3>你的位置专属建议</h3><span class="sub">' + state.loc.n + '</span></div>' +
      advisoryHTML(a) + '</div>';
  }

  /* ══════════ 视图 6：方法学与试点 ══════════ */
  /* ══════════ 数据时效 ══════════ */
  function viewData() {
    var DM = OP.DATA_MANIFEST || {
      sources: [], asOf: OP.META.asOf, latest: OP.META.asOf, generatedAt: '—'
    };
    var KIND = {
      snapshot: ['快照', '会过时'],
      replay: ['回放', '固定场景'],
      static: ['静态', '年度才变'],
      manual: ['手写', '人工更新'],
      model: ['标定', '不随日期变'],
      estimate: ['估算', '年度才变']
    };

    function status(s) {
      if (s.kind !== 'snapshot') {
        return '<span class="tag t-dim">' + KIND[s.kind][0] + '</span>';
      }
      var n = daysAgo(s.date);
      if (n === null) return '<span class="tag t-dim">—</span>';
      var cls = n <= 7 ? 't-teal' : (n <= 30 ? 't-amber' : 't-rad');
      return '<span class="tag ' + cls + '">' + n + ' 天前</span>';
    }

    var rows = DM.sources.map(function (s) {
      return '<tr>' +
        '<td><b>' + s.n + '</b>' +
        '<div class="tiny" style="color:var(--dim);margin-top:4px;line-height:1.6">' + s.use + '</div></td>' +
        '<td class="num">' + (s.date || s.dateText || '—') + '</td>' +
        '<td class="num">' + s.value + '</td>' +
        '<td>' + status(s) +
        '<div class="tiny" style="color:var(--dim);margin-top:4px">' + s.freq + '</div></td>' +
        '<td class="mono tiny" style="color:var(--mut)">' + s.tool + '</td>' +
        '</tr>';
    }).join('');

    var nOld = daysAgo(DM.asOf), nNew = daysAgo(DM.latest);

    return '<div class="phead"><div>' +
      '<div class="eyebrow">DATA FRESHNESS · 数据时效</div>' +
      '<h1 style="margin-top:8px">每个数字，都能查到哪天、从哪来、谁抓的</h1>' +
      '<p>本站是<strong>快照</strong>，不是实时流。打开页面时不发任何网络请求——数据在构建阶段就算好、随页面一起下发。' +
      '断网可用是这个选择的结果，不是数据会自己变新。</p>' +
      '</div></div>' +

      '<div class="kpis">' +
      '<div class="kpi"><div class="k-lab">最旧快照</div>' +
      '<div class="k-val">' + (nOld === null ? '—' : nOld) + '<small> 天前</small></div>' +
      '<div class="k-note">' + (DM.asOf || '—') + ' · 口径取最旧</div></div>' +
      '<div class="kpi"><div class="k-lab">最新快照</div>' +
      '<div class="k-val">' + (nNew === null ? '—' : nNew) + '<small> 天前</small></div>' +
      '<div class="k-note">' + (DM.latest || '—') + '</div></div>' +
      '<div class="kpi"><div class="k-lab">清单生成</div>' +
      '<div class="k-val" style="font-size:22px">' + (DM.generatedAt || '—').slice(5, 16).replace('T', ' ') + '</div>' +
      '<div class="k-note">tools/build_manifest.py</div></div>' +
      '</div>' +

      '<div class="card pad0" style="margin-bottom:16px">' +
      '<div class="card-h" style="padding:18px 20px 14px;margin:0">' +
      '<h3>数据源清单</h3><span class="sub">' + DM.sources.length + ' 个来源 · 按影响范围排序</span></div>' +
      '<table><thead><tr><th>数据</th><th>数据日期</th><th>当前值</th><th>状态</th><th>生成脚本</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>' +
      '<p class="tiny" style="padding:14px 20px;line-height:1.8">' +
      '「天前」按你打开页面的时刻算，所以这份清单会自己变旧——这正是它存在的意义：' +
      '数字过期时，它会明说，而不是假装还新。</p></div>' +

      '<div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="card"><div class="card-h"><h3>三类数据，三种命运</h3><span class="sub">WHY NOT REAL-TIME</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:14px;font-size:11.5px;line-height:1.8">' +
      '<div><b style="color:var(--teal)">快照</b>：流场、批发价。源站是日频，重抓就能变新。' +
      '这两项是「过时感」的主要来源，也是唯一值得上定时任务的。</div>' +
      '<div><b style="color:var(--purple)">回放</b>：大气风场是 2023-08 至 2024-10 的历史场，' +
      '用来还原「水汽从哪来」。它不是今天的天气，也不该每天变。</div>' +
      '<div><b style="color:var(--mut)">常量与标定</b>：排放轮次、抵达天数、产业权重。' +
      '前两个来自公告与文献锚点，第三个是估算——都不随时间漂移，但需要人工核对。</div>' +
      '</div></div>' +

      '<div class="card"><div class="card-h"><h3>怎么刷新</h3><span class="sub">REPRODUCE</span></div>' +
      '<div class="eq" style="font-size:11px;line-height:2">' +
      'python tools/refresh.py<br>' +
      '<span style="color:var(--dim)"># 等价于依次执行：</span><br>' +
      'python tools/fetch_currents.py<br>' +
      'python tools/fetch_prices.py<br>' +
      'python tools/build_manifest.py<br>' +
      'python tools/inline_single.py' +
      '</div>' +
      '<p class="tiny" style="margin-top:12px;line-height:1.8">' +
      '抓取脚本只读公开数据源，不绕过登录、不高频请求。' +
      '刷新后本页的日期会自动跟着变——因为日期是从数据文件里读的，不是手写的。' +
      '批发价源站在境外网络下可能被拦，抓不到就保留上一份，不会把站点弄坏。</p></div>' +
      '</div>' +
      '</div>';
  }

  function viewMethod() {
    return '<div class="phead"><div>' +
      '<div class="eyebrow">METHOD &amp; PILOT · 方法学与验证计划</div>' +
      '<h1 style="margin-top:8px">从一条新闻，到一份可核验的账本</h1>' +
      '<p>产品把「日本排放」这一宏观事件，拆解为任一海岸点位上的三个可回答的问题：何时到、持续多久、到什么程度。</p>' +
      '</div></div>' +

      '<div class="pipe" style="margin-bottom:16px">' +
      [['01', '输运路径标定', '以公开文献的抵达时间为锚点，反演各路径的平均推进速度。', '输入：240 d / 1200 d 锚点'],
       ['02', '点位投影推断', '任意经纬度投影到最近输运路径，叠加横向偏离惩罚，得到抵达天数。', '输入：lon / lat'],
       ['03', '脉冲响应计算', '用 Gamma 型响应函数给出上升—峰值—回落曲线与持续期。', '输入：抵达天数'],
       ['04', '双账本合成', '辐射侧换算为对指导值的比值；生计侧按四因子加权合成指数。', '输出：0–100 指数']]
        .map(function (p) {
          return '<div><div class="p-n">' + p[0] + '</div><div class="p-t">' + p[1] + '</div>' +
            '<div class="p-d">' + p[2] + '</div><div class="p-in">' + p[3] + '</div></div>';
        }).join('') + '</div>' +

      '<div class="grid" style="grid-template-columns:1fr 1fr;margin-bottom:16px">' +
      '<div class="card"><div class="card-h"><h3>核心方程</h3><span class="sub">SCREENING MODEL</span></div>' +
      '<div class="eq">' +
      'T<sub>arr</sub> = min<sub>r</sub> [ D<sub>r</sub>(p) + <em>λ</em> · d<sub>⊥</sub>(p, r) ]<br><br>' +
      'C(t) = C<sub>max</sub> · u² · e<sup>2(1−u)</sup>,&nbsp; u = t / t<sub>p</sub><br><br>' +
      'C<sub>max</sub> = C₀ · 240 / (T<sub>arr</sub> + 240)<br><br>' +
      'R = log₁₀( C<sub>max</sub> / 10⁴ )<br><br>' +
      'L = 100 · (0.34·dep + 0.28·mkt + 0.20·info + 0.18·expo)' +
      '</div>' +
      '<p class="tiny" style="margin-top:12px">λ = 5，横向偏离的二次惩罚系数；t<sub>p</sub> = 1.45·T<sub>arr</sub> 为峰值时刻。所有参数集中在 model.js，可整体替换为区域海洋模型的输出。</p></div>' +

      '<div class="card"><div class="card-h"><h3>AI 承担的具体任务</h3><span class="sub">WHY AI</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:13px;font-size:11.5px;line-height:1.8">' +
      [['① 稀疏观测下的场重建', '监测站只有十几个，模型需要把稀疏点位与流体力学先验融合，重建任意点位的浓度场——这是典型的神经算子/PINN 任务。'],
       ['② 参数反演与同化', '路径速度、扩散系数、横向惩罚需要从锚点与监测数据中反演，属高维非线性优化。'],
       ['③ 多因子非线性映射', '产业依赖、市场敏感、信息不对称到生计压力不是线性关系，用树模型/小型网络拟合。'],
       ['④ 受约束的风险沟通', '把数值翻译成角色化建议，必须锁定数值槽位、禁用恐吓性措辞——生成过程需可审计。']]
        .map(function (r) {
          return '<div><b style="color:var(--teal);font-weight:500">' + r[0] + '</b><br><span class="muted">' + r[1] + '</span></div>';
        }).join('') + '</div>' +
      '<p class="tiny" style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">本 Demo 为可复现版本：物理核与评分核为确定性实现，AI 代理模型接口已预留。这样评审可以逐位复算，不会被随机输出干扰。</p></div>' +
      '</div>' +

      '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>90 天验证计划</h3><span class="sub">FIELD VALIDATION</span></div>' +
      '<table><thead><tr><th>阶段</th><th>周期</th><th>对象</th><th>方法</th><th>成功判据</th></tr></thead><tbody>' +
      [['P0 基线', '第 1–2 周', '象山、舟山 2 家渔业合作社', '访谈 20 人，记录现有信息来源与决策痛点', '≥15 人确认「抵达时间」是其最想知道的信息'],
       ['P1 冷启动', '第 3–6 周', '60 名从业者 + 200 名消费者', 'A/B：传统新闻摘要 vs 本产品双账本页面', '理解准确率提升 ≥30%，恐慌性表述下降 ≥20%'],
       ['P2 数据接入', '第 7–10 周', '1 个县级监测站', '接入实测氚浓度，替换模型先验', '模型与实测偏差 ≤1 个数量级'],
       ['P3 决策嵌入', '第 11–13 周', '合作社收购定价流程', '把批次溯源页嵌入收购环节', '≥30% 批次带可扫码溯源页']]
        .map(function (r) {
          return '<tr><td><b>' + r[0] + '</b></td><td class="num">' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>';
        }).join('') + '</tbody></table></div>' +

      '<div class="grid" style="grid-template-columns:1fr 1fr">' +
      '<div class="card"><div class="card-h"><h3>商业与可持续性</h3><span class="sub">SUSTAINABILITY</span></div>' +
      '<div style="display:flex;flex-direction:column;gap:12px;font-size:11.5px;line-height:1.8">' +
      [['付费方', '水产加工与出口企业（溯源合规）、县级渔业主管部门（监测与沟通）、保险机构（风险定价）'],
       ['收入结构', 'SaaS 订阅（按县/企业）+ 批次检测与溯源服务分成 + 定制化区域评估报告'],
       ['成本结构', '模型推理成本极低；主要成本在数据接入与现场运营'],
       ['推广路径', '中国沿海 11 省 → 日韩与东南亚 → 任何存在跨境海洋污染争议的海区']]
        .map(function (r) {
          return '<div><b style="color:var(--txt);font-weight:500">' + r[0] + '</b><br><span class="muted">' + r[1] + '</span></div>';
        }).join('') + '</div></div>' +

      '<div class="card"><div class="card-h"><h3>已知局限</h3><span class="sub">LIMITATIONS</span></div>' +
      '<div class="adv"><h4>不是预报系统</h4><p>本产品是筛查级工具，用于沟通与优先级排序，<b>不能替代区域海洋模型与官方监测</b>。</p></div>' +
      '<div class="adv"><h4>不评价食品安全</h4><p>浓度对比仅作量级参照。是否可食用由监管机构依据摄入量与核素形态判定。</p></div>' +
      '<div class="adv"><h4>流场来自实测，但只到表层</h4><p>地图表层流场已接入 <b>NOAA CoastWatch 混合表层流</b>（0.25°、日频、近实时），不再是参数化示意。但它只有<b>海面一层</b>，次表层与深层环流仍未知；近岸格点因卫星与模式盲区回退为参数化值。</p></div>' +
      '<div class="adv"><h4>有实测流场，为何抵达时间仍用路径投影</h4><p>单日流场快照不能代表多年输运：黑潮路径的年际摆动、季风反转、中尺度涡的随机游走都会累积。把一天的海流外推 240 天，误差远大于经文献锚点标定的路径模型。正解是用 1993 年至今的再分析流场做<b>粒子追踪集合</b>——这是下一步，不假装已经做了。</p></div>' +
      '<div class="adv"><h4>数据仍需本地化</h4><p>省级产业权重为估算值，上线前必须替换为县级统计年鉴数据。</p></div></div>' +
      '</div>';
  }

  /* ══════════ 事件绑定 ══════════ */
  function wire(k) {
    $$('[data-go]').forEach(function (b) {
      b.addEventListener('click', function () { go(b.dataset.go); });
    });
    if (k === 'map') return;
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
