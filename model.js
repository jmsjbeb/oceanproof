/* ═══════════════════════════════════════════════════════════
   海证 OceanProof — 筛选级扩散模型
   物理骨架：沿洋流路径的一维输运 + 横向扩散惩罚 + 脉冲响应函数
   标定锚点：240 天（中国沿岸）/ 1200 天（北美西岸），源自公开文献
   定位：筛查与沟通级（screening-level），非业务化预报
   ═══════════════════════════════════════════════════════════ */
window.OP = window.OP || {};

OP.model = (function () {
  var START = Date.UTC(2023, 7, 24);          // 2023-08-24 首轮排放
  var DAY = 86400000;
  var C0 = 0.019;                             // 近场峰值标定常数 (Bq/L)
  var LATERAL = 5.0;                          // 横向偏离惩罚系数（天/度的平方）
  var LATERAL_EXP = 2.0;
  var MAX_LATERAL = 8.0;                      // 超过该偏离度视为不在该路径上（度）
  var WHO = 10000;                            // Bq/L
  var DISCHARGE_END = Date.UTC(2053, 2, 1);   // 计划排放期结束

  /* ── 点到折线的最短距离与参数位置 ── */
  function nearestOnPolyline(lon, lat, pts) {
    var best = null;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var vx = b[0] - a[0], vy = b[1] - a[1];
      var wx = lon - a[0], wy = lat - a[1];
      var len2 = vx * vx + vy * vy;
      var t = len2 === 0 ? 0 : (wx * vx + wy * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      var px = a[0] + t * vx, py = a[1] + t * vy;
      var dx = lon - px, dy = lat - py;
      var d = Math.sqrt(dx * dx + dy * dy);
      var day = a[2] + t * (b[2] - a[2]);
      if (!best || d < best.d) best = { d: d, day: day };
    }
    return best;
  }

  /* ── 抵达时间：在全部路径中取 (路径日 + 横向惩罚) 最小者 ── */
  function travel(lon, lat) {
    var best = null;
    for (var k in OP.ROUTES) {
      var r = OP.ROUTES[k];
      var nb = nearestOnPolyline(lon, lat, r);
      if (!nb) continue;
      if (nb.d > MAX_LATERAL) continue;          // 不在该路径的影响带内
      var total = nb.day + LATERAL * Math.pow(nb.d, LATERAL_EXP);
      if (!best || total < best.days) best = { days: total, route: k, lateral: nb.d };
    }
    if (!best) {                                  // 极端情况：退化到最近路径
      for (var k2 in OP.ROUTES) {
        var nb2 = nearestOnPolyline(lon, lat, OP.ROUTES[k2]);
        if (!nb2) continue;
        var t2 = nb2.day + LATERAL * Math.pow(nb2.d, LATERAL_EXP);
        if (!best || t2 < best.days) best = { days: t2, route: k2, lateral: nb2.d };
      }
    }
    return best;
  }

  var ROUTE_CN = {
    china: '东海陆架—浙闽沿岸路径',
    fujian: '浙闽沿岸流—台湾海峡西岸路径',
    yellow: '黄海暖流—渤海路径',
    south: '黑潮—巴士海峡—南海路径',
    japansea: '对马暖流—日本海路径',
    pacific: '黑潮延伸体—北太平洋路径'
  };

  /* ── 单轮脉冲浓度响应 ── */
  function conc(t, tArr) {
    if (t <= 0) return 0;
    var cMax = C0 * (240 / (tArr + 240));
    var tp = tArr * 1.45;
    var u = t / tp;
    return cMax * u * u * Math.exp(2 * (1 - u));
  }

  function peakConc(tArr) { return C0 * (240 / (tArr + 240)); }

  /* 连续排放下的累积浓度：抵达后按指数饱和，形成可见的移动锋面 */
  function concAcc(t, tArr) {
    if (t <= tArr) return 0;
    var cMax = C0 * (240 / (tArr + 240));
    var tau = Math.max(30, tArr * 0.18);
    return cMax * (1 - Math.exp(-(t - tArr) / tau));
  }

  /* 浓度回落至峰值 2% 所需时间（数值求解） */
  function flushDays(tArr) {
    var tp = tArr * 1.45, lo = tp, hi = tp * 9;
    for (var i = 0; i < 60; i++) {
      var mid = (lo + hi) / 2;
      var u = mid / tp;
      var f = u * u * Math.exp(2 * (1 - u));
      if (f > 0.02) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dateOf(day) { return new Date(START + day * DAY); }
  function fmt(d) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    return y + '.' + (m < 10 ? '0' + m : m);
  }
  function fmtFull(d) {
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }

  /* ══════════ 大气通路模型 ══════════
     氚以 HTO（氚水）形式存在，蒸发时**不分馏**——比活度不会因为相变而下降。
     所以"蒸发了就稀释没了"是错的。真正的稀释来自两处：
       ① 与未污染水汽混合（海洋源水汽占比随离岸距离下降）
       ② 落到地面后的土壤吸附、作物吸收与径流再分配
     两条腿：
       A. 海盐气溶胶 —— 风把含氚的海盐液滴直接吹上岸，e 折距离约 25 km，小时到 2 天
       B. 水汽循环   —— 蒸发→输送→降水，大气滞留约 9 天，全域可达
     定位：量级判断，不是沉降预报。 */
  var ATM = {
    vaporDays: 9,           // 大气水汽滞留时间 (d)
    sprayDecayKm: 25,       // 海盐气溶胶 e 折距离 (km)
    sprayWaterFrac: 1e-3,   // 气溶胶液态水 / 海水 的量级比
    oceanicBase: 0.10,      // 近岸气团中"受污染海域来源"水汽占比（保守高估）
    oceanicScaleKm: 900,    // 海洋源占比随离岸距离的衰减尺度 (km)
    naturalRain: 0.1        // 天然宇宙成因氚在降水中的量级下限 (Bq/L)
  };

  function haversine(lon1, lat1, lon2, lat2) {
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* 到最近海岸点位的大圆距离（用城市表作海岸参照，避免手绘陆地多边形的空洞） */
  function nearestCoast(lon, lat) {
    var best = null;
    for (var i = 0; i < OP.CITIES.length; i++) {
      var c = OP.CITIES[i];
      if (c.t === 'inland') continue;
      var d = haversine(lon, lat, c.lon, c.lat);
      if (!best || d < best.km) best = { km: d, lon: c.lon, lat: c.lat, n: c.n };
    }
    return best;
  }

  /* 查 NCEP 追踪得到的真实 f_ocean（海洋源水汽占比），回退到经验公式 */
  function lookupAtmosF(lon, lat) {
    var A = window.OP && OP.ATMOS_F;
    if (!A || !A.f) return null;
    var ix = Math.floor((lon - A.lon0) / A.res);
    var iy = Math.floor((lat - A.lat0) / A.res);
    if (ix < 0 || ix >= A.nx || iy < 0 || iy >= A.ny) return null;
    var v = A.f[iy][ix];
    return (v > 0 && v < 1) ? v : null;
  }

  function atmos(city) {
    var nw = nearestCoast(city.lon, city.lat);
    var d = nw ? nw.km : 300;
    var ref = nw ? travel(nw.lon, nw.lat) : travel(city.lon, city.lat);
    var tSea = Math.max(1, Math.round(ref ? ref.days : 240));
    var cSea = peakConc(tSea);                       // 最近海域的海水峰值浓度

    // A. 海盐气溶胶
    var cSpray = cSea * ATM.sprayWaterFrac * Math.exp(-d / ATM.sprayDecayKm);
    var tSpray = 0.15 + d / 500;                     // 小时到天

    // B. 水汽循环：优先用 NCEP 追踪数据，回退到经验公式
    var fTracked = lookupAtmosF(city.lon, city.lat);
    var fOcean = fTracked !== null ? fTracked
      : clamp(ATM.oceanicBase * Math.exp(-d / ATM.oceanicScaleKm), 0.03, ATM.oceanicBase);
    var cRain = cSea * fOcean;
    var tVapor = ATM.vaporDays + d / 1500 * 6;       // 9–15 天

    var cTot = cRain + cSpray;
    var pr = city.pr || 800;
    var ratio = cTot / WHO;

    var tier = ratio < 1e-8 ? '可忽略'
      : ratio < 1e-6 ? '极低'
      : ratio < 1e-4 ? '低' : '需关注';

    return {
      dCoast: d, tSea: tSea, cSea: cSea, refCity: nw ? nw.n : null,
      cSpray: cSpray, tSpray: tSpray,
      cRain: cRain, tVapor: tVapor, fOcean: fOcean, fTracked: fTracked !== null,
      cMax: cTot, ratio: ratio, logRatio: Math.log10(Math.max(ratio, 1e-12)),
      depo: cRain * pr, precip: pr,
      vsNatural: cRain / ATM.naturalRain,
      dominant: cSpray >= cRain ? 'spray' : 'vapor',
      tier: tier
    };
  }

  /* ── 主评估函数 ── */
  function assess(city) {
    var inland = city.t === 'inland';
    var tr = inland ? { days: 0, route: 'china', lateral: 0 } : travel(city.lon, city.lat);
    var tArr = Math.round(tr.days);
    var isCoastal = !inland;

    var cMax = isCoastal ? peakConc(tArr) : 0;
    var ratio = isCoastal ? cMax / WHO : 0;
    var logRatio = isCoastal ? Math.log10(ratio) : -9;

    var flush = isCoastal ? flushDays(tArr) : 0;
    var arrivalDate = isCoastal ? dateOf(tArr) : null;
    var pulseEnd = isCoastal ? dateOf(tArr + flush) : null;

    var expo = isCoastal ? clamp(1 - (tArr - 80) / 1000, 0, 1) : 0;
    var L = Math.round(100 * (0.34 * city.dep + 0.28 * city.mkt + 0.20 * city.info + 0.18 * expo));
    L = clamp(L, 0, 100);

    var sh = city.share;
    var sectorRaw = [
      sh[0] * (0.55 * expo + 0.45 * city.mkt) * 115,
      sh[1] * (0.60 * expo + 0.40 * city.mkt) * 110,
      sh[2] * (0.30 * expo + 0.70 * city.mkt) * 55,
      sh[3] * (0.15 * expo + 0.85 * city.mkt) * 28
    ];
    var sector = sectorRaw.map(function (v) { return Math.round(clamp(v, 0, 100)); });

    var radTier, radColor;
    if (!isCoastal) { radTier = '无直接通路'; radColor = 'dim'; }
    else if (ratio < 1e-5) { radTier = '极低'; radColor = 'teal'; }
    else if (ratio < 1e-3) { radTier = '低'; radColor = 'teal'; }
    else if (ratio < 1e-1) { radTier = '中'; radColor = 'rad'; }
    else { radTier = '高'; radColor = 'red'; }

    var liveTier, liveColor;
    if (L < 30) { liveTier = '低'; liveColor = 'teal'; }
    else if (L < 50) { liveTier = '中低'; liveColor = 'blue'; }
    else if (L < 70) { liveTier = '中'; liveColor = 'amber'; }
    else if (L < 82) { liveTier = '中高'; liveColor = 'amber'; }
    else { liveTier = '高'; liveColor = 'red'; }

    return {
      city: city, inland: inland, tArr: tArr, route: tr.route,
      routeName: ROUTE_CN[tr.route], lateral: tr.lateral,
      arrivalDate: arrivalDate, pulseEnd: pulseEnd,
      cMax: cMax, ratio: ratio, logRatio: logRatio,
      radTier: radTier, radColor: radColor,
      L: L, liveTier: liveTier, liveColor: liveColor,
      expo: expo, sector: sector,
      dischargeEnd: new Date(DISCHARGE_END)
    };
  }

  /* ── 浓度曲线（用于图表）── */
  function curve(city, n) {
    var a = assess(city);
    n = n || 120;
    var span = a.inland ? 1200 : Math.round(a.tArr * 8);
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = span * i / n;
      out.push({ t: t, c: a.inland ? 0 : conc(t, a.tArr) });
    }
    return { pts: out, span: span, assess: a };
  }

  /* ── 时间轴分段（用于总览条）── */
  function timeline(a) {
    var segs = [];
    if (a.inland) {
      segs.push({ from: 0, to: 11000, color: 'rgba(87,169,255,.45)', label: '市场传导' });
      return segs;
    }
    segs.push({ from: 0, to: a.tArr, color: 'rgba(255,255,255,.10)', label: '输运中' });
    segs.push({ from: a.tArr, to: a.tArr + a.tArr * 1.45, color: 'rgba(242,179,75,.65)', label: '上升期' });
    segs.push({ from: a.tArr * 2.45, to: a.tArr * 2.45 + a.tArr * 4.2, color: 'rgba(47,227,192,.55)', label: '回落期' });
    return segs;
  }

  /* ══════════ 食用安全性：把"水里有多少"换算成"吃了会怎样" ══════════
     这一步是产品必须回答、但多数科普避而不谈的问题。
     全部用公开的剂量学常数，不做健康结论，只做量级换算。

     关键常数（均可查证）：
       氚（HTO）食入剂量系数  1.8×10⁻¹¹ Sv/Bq   ICRP 72
       氚（OBT）食入剂量系数  4.2×10⁻¹¹ Sv/Bq   ICRP 72
       鱼类对氚的浓缩系数 CF  ≈ 1 L/kg          IAEA TRS-472（HTO 不生物富集）
       食品中氚指导值        1×10⁴ Bq/kg        Codex CXS 193-1995；日本同值
       天然本底有效剂量      2.4 mSv/年          UNSCEAR 2008 全球平均
  */
  var FOOD = {
    cf: 1.0,              // L/kg，氚以 HTO 形式与水体同活度，不富集
    doseHTO: 1.8e-11,     // Sv/Bq
    doseOBT: 4.2e-11,     // Sv/Bq
    guide: 1e4,           // Bq/kg 食品指导值
    background: 2.4e-3,   // Sv/年 天然本底
    intake: 50,           // kg/年 中国人均水产品消费量（量级）
    c0Uncertainty: 10     // C0 为手设标定常数，不确定度约 1 个数量级
  };

  /* 数量级字符串：3.2e-3 → "3×10⁻³"；9.8e-3 → "10⁻²"（进位归一）
     只保留 1 位有效数字——C0 本身只有量级意义，多给位数就是假精度 */
  function magnitude(v) {
    if (!(v > 0)) return '0';
    var e = Math.floor(Math.log10(v));
    var m = v / Math.pow(10, e);
    if (m >= 6.3) { m = 1; e += 1; }               // 9.8 → 10⁻(e+1)
    var mStr = m >= 2.8 ? '3' : (m >= 1.4 ? '1.5' : '1');
    var sup = String(e).replace('-', '⁻').replace(/[0-9]/g, function (d) { return '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]; });
    return mStr + '×10' + sup;
  }

  function food(cWater) {
    var cFish = Math.max(cWater, 0) * FOOD.cf;
    var perKg = cFish * FOOD.doseHTO;                  // 吃 1 kg 的待积有效剂量 Sv
    var perYear = cFish * FOOD.intake * FOOD.doseHTO;  // 按年消费量
    // 区间：C0 不确定度 ×10 / ÷10 —— 界面只呈现量级结论，不呈现假精度
    var cFishLo = cFish / FOOD.c0Uncertainty, cFishHi = cFish * FOOD.c0Uncertainty;
    var perYearLo = cFishLo * FOOD.intake * FOOD.doseHTO;
    var perYearHi = cFishHi * FOOD.intake * FOOD.doseHTO;
    var vsLo = perYearLo / FOOD.background, vsHi = perYearHi / FOOD.background;
    var orders = Math.floor(Math.log10(1 / Math.max(vsHi, 1e-12)));  // 与天然本底相差的数量级（取最保守一端）
    return {
      cWater: cWater, cFish: cFish,
      cFishLo: cFishLo, cFishHi: cFishHi,
      perKg: perKg, perYear: perYear,
      perYearLo: perYearLo, perYearHi: perYearHi,
      pctGuide: cFish / FOOD.guide,
      kgToLimit: cFish > 0 ? FOOD.guide / cFish : Infinity,
      vsBackground: perYear / FOOD.background,
      vsLo: vsLo, vsHi: vsHi, ordersBelow: orders,
      magCWater: magnitude(cWater), magCFish: magnitude(cFish),
      magPerYearLo: magnitude(perYearLo), magPerYearHi: magnitude(perYearHi),
      /* 等价的日常参照 */
      equalXray: perYear / 2e-5,
      equalBanana: perYear / 1e-7,
      /* 结论用区间的最保守一端判定 */
      verdict: vsHi < 1e-6 ? '完全可忽略'
        : vsHi < 1e-4 ? '可忽略'
        : vsHi < 1e-2 ? '远低于本底'
        : vsHi < 0.1 ? '低于本底波动' : '需进一步评估'
    };
  }

  return {
    START: START, WHO: WHO, DISCHARGE_END: DISCHARGE_END,
    assess: assess, curve: curve, timeline: timeline, travel: travel,
    atmos: atmos, ATM: ATM, nearestCoast: nearestCoast, haversine: haversine,
    food: food, FOOD: FOOD, magnitude: magnitude,
    conc: conc, peakConc: peakConc, concAcc: concAcc,
    dateOf: dateOf, fmt: fmt, fmtFull: fmtFull, clamp: clamp,
    ROUTE_CN: ROUTE_CN
  };
})();
