/* ═══════════════════════════════════════════════════════════
   海证 OceanProof — 流场层
   由公开洋流路径与典型流速参数化生成气候态示意流场。
   非实时海流数据；分辨率 0.2°，用于可视化与粒子推进。
   ═══════════════════════════════════════════════════════════ */
window.OP = window.OP || {};

OP.field = (function () {
  var LON0 = 100, LON1 = 170, LAT0 = 45, LAT1 = 15;
  var NX = 351, NY = 151;
  var dLon = (LON1 - LON0) / (NX - 1);
  var dLat = (LAT0 - LAT1) / (NY - 1);

  var U = new Float32Array(NX * NY);
  var V = new Float32Array(NX * NY);
  var SPD = new Float32Array(NX * NY);
  var MASK = new Uint8Array(NX * NY);   // 1 = 水体

  // 浓度场网格（0.5°）
  var TX = 141, TY = 121;
  var TARR = new Float32Array(TX * TY);

  /* ── 洋流定义：路径 + 典型流速(m/s) + 影响带宽(°) ── */
  var CURRENTS = [
    { n: '黑潮', s: 1.55, w: 0.85, p: [[122.4,22.4],[124.2,25.0],[126.4,27.8],[128.6,30.2],[131.2,31.6],[134.2,32.8],[137.2,33.9],[140.2,35.0]] },
    { n: '黑潮延伸体', s: 0.85, w: 1.7, p: [[140.2,35.0],[143.4,35.9],[146.6,36.6],[150.5,37.2],[155.0,37.6],[160.0,38.2],[166.0,39.0],[170.0,39.8]] },
    { n: '对马暖流', s: 0.48, w: 0.7, p: [[128.6,30.4],[129.4,33.2],[131.0,35.0],[133.2,37.2],[136.0,39.0],[139.2,41.0]] },
    { n: '亲潮', s: 0.72, w: 1.15, p: [[170.0,45.0],[164.0,43.6],[157.0,42.4],[150.5,42.6],[146.4,42.6],[143.6,41.0],[142.2,39.4]] },
    { n: '台湾暖流', s: 0.55, w: 0.65, p: [[121.0,21.6],[121.8,24.4],[122.4,26.8],[122.8,28.8]] },
    { n: '黄海沿岸流', s: 0.22, w: 0.8, p: [[123.2,33.6],[122.4,35.4],[121.4,36.8],[120.2,38.2],[118.8,39.2]] },
    { n: '南海环流', s: 0.34, w: 1.5, p: [[109.0,17.2],[112.4,18.6],[115.6,20.2],[118.0,21.6],[119.8,22.4]] },
    { n: '东海陆架流', s: 0.30, w: 1.0, p: [[127.0,28.4],[124.6,28.2],[122.6,27.6],[121.2,26.6],[120.2,25.6]] }
  ];

  /* ── 中尺度涡（位置、半径、切向速度）── */
  var EDDIES = [
    { lon: 146.5, lat: 34.2, r: 2.6, s: 0.34 },
    { lon: 152.0, lat: 35.6, r: 3.2, s: -0.30 },
    { lon: 158.5, lat: 36.4, r: 3.6, s: 0.28 },
    { lon: 164.0, lat: 37.2, r: 3.0, s: -0.24 },
    { lon: 133.5, lat: 29.0, r: 2.4, s: 0.22 },
    { lon: 138.0, lat: 33.0, r: 2.0, s: -0.20 },
    { lon: 115.5, lat: 17.0, r: 3.0, s: 0.26 },
    { lon: 121.0, lat: 19.5, r: 2.6, s: -0.22 }
  ];

  function idx(ix, iy) { return iy * NX + ix; }
  function lonAt(ix) { return LON0 + ix * dLon; }
  function latAt(iy) { return LAT0 - iy * dLat; }

  /* ── 陆地掩膜：把多边形栅格化 ── */
  function buildMask() {
    var c = document.createElement('canvas');
    c.width = NX; c.height = NY;
    var g = c.getContext('2d');
    g.fillStyle = '#fff';
    if (OP.LAND_WORLD) {
      /* 真实海岸线（Natural Earth 1:50m） */
      for (var i = 0; i < OP.LAND_WORLD.length; i++) {
        var r = OP.LAND_WORLD[i].p;
        g.beginPath();
        for (var j = 0; j < r.length; j++) {
          var x = (r[j][0] - LON0) / dLon;
          var y = (LAT0 - r[j][1]) / dLat;
          if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fill();
      }
    } else {
      for (var k in OP.LAND) {
        var pts = OP.LAND[k];
        g.beginPath();
        for (var m = 0; m < pts.length; m++) {
          var x2 = (pts[m][0] - LON0) / dLon;
          var y2 = (LAT0 - pts[m][1]) / dLat;
          if (m === 0) g.moveTo(x2, y2); else g.lineTo(x2, y2);
        }
        g.closePath();
        g.fill();
      }
    }
    var d = g.getImageData(0, 0, NX, NY).data;
    for (var n = 0; n < NX * NY; n++) {
      MASK[n] = d[n * 4 + 3] > 100 ? 0 : 1;
    }
  }

  /* ── 叠加一条洋流：仅遍历该段包围盒内的格点 ── */
  function addCurrent(cc) {
    var p = cc.p, w = cc.w, s = cc.s;
    var reach = w * 3.2;
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1];
      var vx = b[0] - a[0], vy = b[1] - a[1];
      var len = Math.sqrt(vx * vx + vy * vy) || 1e-6;
      var tx = vx / len, ty = vy / len;
      var ix0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - LON0) / dLon));
      var ix1 = Math.min(NX - 1, Math.ceil((Math.max(a[0], b[0]) + reach - LON0) / dLon));
      var iy0 = Math.max(0, Math.floor((LAT0 - Math.max(a[1], b[1]) - reach) / dLat));
      var iy1 = Math.min(NY - 1, Math.ceil((LAT0 - Math.min(a[1], b[1]) + reach) / dLat));
      for (var iy = iy0; iy <= iy1; iy++) {
        var lat = latAt(iy);
        for (var ix = ix0; ix <= ix1; ix++) {
          var lon = lonAt(ix);
          var wx = lon - a[0], wy = lat - a[1];
          var t = (wx * vx + wy * vy) / (len * len);
          t = Math.max(0, Math.min(1, t));
          var px = a[0] + t * vx, py = a[1] + t * vy;
          var dx = lon - px, dy = lat - py;
          var d = Math.sqrt(dx * dx + dy * dy);
          var g = Math.exp(-(d * d) / (w * w));
          if (g < 0.004) continue;
          var j = idx(ix, iy);
          U[j] += g * s * tx;
          V[j] += g * s * ty;
        }
      }
    }
  }

  /* ══════════ 真实流场叠加 ══════════
     若 OP.CURRENTS_DATA 存在（由 tools/fetch_currents.py 生成），
     用 NOAA CoastWatch 的实测表层流替换参数化流场。
     陆地与近岸（源数据为 NaN）保留参数化值，避免海岸线出现空洞。 */
  var REAL = false, REAL_META = null;

  function decodeInt16(b64) {
    var bin = atob(b64), n = bin.length >> 1;
    var out = new Int16Array(n);
    for (var i = 0; i < n; i++) {
      var v = bin.charCodeAt(i << 1) | (bin.charCodeAt((i << 1) + 1) << 8);
      out[i] = v > 32767 ? v - 65536 : v;
    }
    return out;
  }

  function applyReal() {
    var D = OP.CURRENTS_DATA;
    if (!D || !D.u || !D.v || !D.nx) return;
    var ru, rv;
    try { ru = decodeInt16(D.u); rv = decodeInt16(D.v); } catch (e) { return; }
    var RNX = D.nx, RNY = D.ny;
    if (ru.length < RNX * RNY || rv.length < RNX * RNY) return;

    var sc = D.scale || 0.01;
    var NAN = D.nan === undefined ? -32768 : D.nan;
    var rlon0 = D.lon0, rlon1 = D.lon1;
    var rlat0 = D.lat0, rlat1 = D.lat1;          // 文件第 0 行 = lat0（南）
    if (rlat1 < rlat0) { rlat0 = D.lat1; rlat1 = D.lat0; }

    function get(arr, ix, iy) {
      var q = arr[iy * RNX + ix];
      return q === NAN ? null : q * sc;
    }

    var hit = 0, total = 0;
    for (var iy = 0; iy < NY; iy++) {
      var lat = latAt(iy);
      var fy = (lat - rlat0) / (rlat1 - rlat0) * (RNY - 1);
      for (var ix = 0; ix < NX; ix++) {
        var lon = lonAt(ix);
        var j = idx(ix, iy);
        if (!MASK[j]) continue;
        total++;
        var fx = (lon - rlon0) / (rlon1 - rlon0) * (RNX - 1);
        if (fx < 0 || fy < 0 || fx > RNX - 1.001 || fy > RNY - 1.001) continue;
        var x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0;
        var u00 = get(ru, x0, y0), u10 = get(ru, x0 + 1, y0),
            u01 = get(ru, x0, y0 + 1), u11 = get(ru, x0 + 1, y0 + 1);
        var v00 = get(rv, x0, y0), v10 = get(rv, x0 + 1, y0),
            v01 = get(rv, x0, y0 + 1), v11 = get(rv, x0 + 1, y0 + 1);
        // 四邻域任一为 NaN 说明是陆地边缘，保留参数化值
        if (u00 === null || u10 === null || u01 === null || u11 === null ||
            v00 === null || v10 === null || v01 === null || v11 === null) continue;
        var u = (u00 * (1 - ax) + u10 * ax) * (1 - ay) + (u01 * (1 - ax) + u11 * ax) * ay;
        var v = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
        U[j] = u; V[j] = v;
        var sp = Math.sqrt(u * u + v * v);
        SPD[j] = sp;
        hit++;
      }
    }
    if (!hit) return;
    REAL = true;
    REAL_META = { date: D.date, source: D.source, sourceUrl: D.sourceUrl,
                  res: Math.abs(D.lon1 - D.lon0) / (RNX - 1),
                  cover: total ? hit / total : 0, fetchedAt: D.fetchedAt };
  }

  function build() {
    buildMask();
    U.fill(0); V.fill(0);
    CURRENTS.forEach(addCurrent);

    // 副热带环流背景 + 涡旋
    for (var iy = 0; iy < NY; iy++) {
      var lat = latAt(iy);
      for (var ix = 0; ix < NX; ix++) {
        var lon = lonAt(ix);
        var j = idx(ix, iy);
        if (!MASK[j]) { U[j] = 0; V[j] = 0; continue; }

        // 大尺度环流：以 (152,30) 为中心的顺时针涡旋
        var gx = lon - 152, gy = lat - 30;
        var gr = Math.sqrt(gx * gx + gy * gy) / 22;
        if (gr < 1.4) {
          var gs = 0.16 * Math.exp(-gr * gr);
          U[j] += -gy / 22 * gs * 2.2;
          V[j] += gx / 22 * gs * 2.2;
        }
        // 黑潮延伸体处的东向急流补强
        if (lon > 143 && lon < 170 && lat > 33 && lat < 42) {
          var band = Math.exp(-Math.pow((lat - 37.4) / 3.0, 2));
          U[j] += 0.55 * band * Math.min(1, (lon - 143) / 8);
        }
        // 中尺度涡
        for (var e = 0; e < EDDIES.length; e++) {
          var ed = EDDIES[e];
          var ex = lon - ed.lon, ey = lat - ed.lat;
          var rr = Math.sqrt(ex * ex + ey * ey);
          if (rr > ed.r * 2.4) continue;
          var wgt = Math.exp(-Math.pow(rr / ed.r, 2));
          U[j] += -ey / ed.r * ed.s * wgt;
          V[j] += ex / ed.r * ed.s * wgt;
        }
        // 细尺度扰动
        U[j] += 0.045 * Math.sin(lon * 0.9 + lat * 1.3) * Math.cos(lat * 0.7);
        V[j] += 0.045 * Math.cos(lon * 1.1 - lat * 0.8) * Math.sin(lon * 0.5);

        var sp = Math.sqrt(U[j] * U[j] + V[j] * V[j]);
        if (sp > 2.2) { var k = 2.2 / sp; U[j] *= k; V[j] *= k; sp = 2.2; }
        SPD[j] = sp;
      }
    }
    applyReal();
  }

  /* ── 双线性采样 ── */
  function sample(lon, lat) {
    var fx = (lon - LON0) / dLon, fy = (LAT0 - lat) / dLat;
    if (fx < 0 || fy < 0 || fx > NX - 1.001 || fy > NY - 1.001) return { u: 0, v: 0, s: 0, land: true };
    var ix = fx | 0, iy = fy | 0;
    var ax = fx - ix, ay = fy - iy;
    var j00 = idx(ix, iy), j10 = j00 + 1, j01 = j00 + NX, j11 = j01 + 1;
    if (!MASK[j00] || !MASK[j10] || !MASK[j01] || !MASK[j11]) return { u: 0, v: 0, s: 0, land: true };
    var u = (U[j00] * (1 - ax) + U[j10] * ax) * (1 - ay) + (U[j01] * (1 - ax) + U[j11] * ax) * ay;
    var v = (V[j00] * (1 - ax) + V[j10] * ax) * (1 - ay) + (V[j01] * (1 - ax) + V[j11] * ax) * ay;
    return { u: u, v: v, s: Math.sqrt(u * u + v * v), land: false };
  }

  function isWater(lon, lat) {
    var ix = Math.round((lon - LON0) / dLon), iy = Math.round((LAT0 - lat) / dLat);
    if (ix < 0 || iy < 0 || ix >= NX || iy >= NY) return false;
    return !!MASK[idx(ix, iy)];
  }

  /* ── 到最近海域的距离与方位（用于内陆城市的大气通路计算）── */
  function nearestWater(lon, lat) {
    var ix0 = Math.round((lon - LON0) / dLon), iy0 = Math.round((LAT0 - lat) / dLat);
    if (ix0 < 0 || iy0 < 0 || ix0 >= NX || iy0 >= NY) return null;
    if (MASK[idx(ix0, iy0)]) return { km: 0, lon: lon, lat: lat };
    var cosLat = Math.cos(lat * Math.PI / 180);
    var minStep = Math.min(dLon * 111.32 * cosLat, dLat * 111.32);  // 每环最小间距
    var best = null, maxR = Math.max(NX, NY);
    for (var r = 1; r < maxR; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var ix = ix0 + dx, iy = iy0 + dy;
          if (ix < 0 || iy < 0 || ix >= NX || iy >= NY) continue;
          if (!MASK[idx(ix, iy)]) continue;
          var kx = dx * dLon * 111.32 * cosLat;
          var ky = dy * dLat * 111.32;
          var d = Math.sqrt(kx * kx + ky * ky);
          if (!best || d < best.km) {
            best = { km: d, lon: lonAt(ix), lat: latAt(iy) };
          }
        }
      }
      if (best && best.km <= r * minStep) break;   // 下一环不可能更近
    }
    return best;
  }

  /* ── 抵达时间场：静态，只算一次 ── */
  function buildTArr() {
    for (var iy = 0; iy < TY; iy++) {
      // 图像行序：第 0 行对应最北（lat = LAT0），与屏幕 y 方向一致
      var lat = LAT0 - (LAT0 - LAT1) * iy / (TY - 1);
      for (var ix = 0; ix < TX; ix++) {
        var lon = LON0 + (LON1 - LON0) * ix / (TX - 1);
        var j = iy * TX + ix;
        if (!isWater(lon, lat)) { TARR[j] = -1; continue; }
        var t = OP.model.travel(lon, lat);
        TARR[j] = t ? t.days : 99999;
      }
    }
  }

  return {
    NX: NX, NY: NY, TX: TX, TY: TY,
    LON0: LON0, LON1: LON1, LAT0: LAT0, LAT1: LAT1,
    U: U, V: V, SPD: SPD, MASK: MASK, TARR: TARR,
    build: build, sample: sample, isWater: isWater, buildTArr: buildTArr,
    nearestWater: nearestWater,
    CURRENTS: CURRENTS,
    isReal: function () { return REAL; },
    realMeta: function () { return REAL_META; }
  };
})();
