/* ═══════════════════════════════════════════════════════════
   海证 OceanProof — 流场渲染器
   双层 Canvas：底层场（速度/浓度热力图），上层粒子（拖尾流线）
   ═══════════════════════════════════════════════════════════ */
window.OP = window.OP || {};

OP.flowmap = (function () {
  var host, svg, cvF, cvP, ctxF, ctxP;
  var W = 0, H = 0, OX = 0, OY = 0, S = 1, DPR = 1;
  var parts = [];
  var day = 0, mode = 'disp';
  var raf = 0, lastT = 0, running = false;
  var ofsS, ofsC, octxS, octxC, imgS = null;
  var K = 6.0;                       // 显示速度：度/秒 每 (m/s)
  var PN = 3000;

  function lerp(a, b, t) { return a + (b - a) * t; }

  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t));
    for (var i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        var a = stops[i], b = stops[i + 1];
        var k = (t - a[0]) / (b[0] - a[0] || 1);
        return [
          Math.round(lerp(a[1][0], b[1][0], k)),
          Math.round(lerp(a[1][1], b[1][1], k)),
          Math.round(lerp(a[1][2], b[1][2], k)),
          Math.round(lerp(a[1][3], b[1][3], k))
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  /* 洋流速度色标：纯蓝绿系，与核污染紫系彻底区分 */
  var RAMP_SPEED = [
    [0.00, [18, 56, 84, 0]],
    [0.10, [24, 88, 126, 120]],
    [0.28, [30, 142, 176, 175]],
    [0.48, [47, 227, 192, 200]],
    [0.70, [30, 200, 160, 210]],
    [0.86, [20, 180, 140, 222]],
    [1.00, [10, 160, 120, 232]]
  ];
  /* 核污染扩散浓度色标：深紫 → 紫 → 亮紫 → 粉红
     低浓度段 alpha 极低，高浓度核心区才明显可见。
     物理事实：连续排放 3 年后低浓度区域确实存在，但视觉上不应与高浓度核心区同等突出。 */
  var RAMP_CONC = [
    [0.00, [20, 10, 45, 0]],
    [0.25, [55, 22, 100, 0]],     // c < 0.004 几乎透明
    [0.45, [110, 42, 175, 18]],   // 低浓度：淡到仅可辨识
    [0.65, [170, 65, 230, 65]],   // 中等浓度：可见轨迹
    [0.85, [225, 95, 210, 130]],  // 较高浓度：明显紫色
    [1.00, [255, 125, 195, 175]]  // 高浓度核心区：亮紫
  ];

  /* ══════════ 初始化 ══════════ */
  function init(hostEl, svgEl) {
    host = hostEl; svg = svgEl;
    cvF = document.createElement('canvas');
    cvP = document.createElement('canvas');
    cvF.className = 'fx-layer'; cvP.className = 'fx-layer';
    host.insertBefore(cvF, svg);
    host.insertBefore(cvP, svg);
    ctxF = cvF.getContext('2d');
    ctxP = cvP.getContext('2d');

    if (!OP.field._built) {
      OP.field.build();
      OP.field._built = true;
    }
    if (!OP.field._tarr) {
      OP.field.buildTArr();
      OP.field._tarr = true;
    }
    ofsS = document.createElement('canvas');
    ofsS.width = OP.field.NX; ofsS.height = OP.field.NY;
    octxS = ofsS.getContext('2d');
    ofsC = document.createElement('canvas');
    ofsC.width = OP.field.TX; ofsC.height = OP.field.TY;
    octxC = ofsC.getContext('2d');

    resize();
    window.addEventListener('resize', onResize);
    spawnAll();
    renderField();
    start();
  }

  function onResize() {
    clearTimeout(onResize._t);
    onResize._t = setTimeout(function () { resize(); }, 120);
  }

  function resize() {
    if (!host) return;
    var r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width; H = r.height;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    [cvF, cvP].forEach(function (c) {
      c.width = Math.round(W * DPR);
      c.height = Math.round(H * DPR);
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    ctxF.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctxP.setTransform(DPR, 0, 0, DPR, 0, 0);
    S = Math.min(W / 1400, H / 600);
    OX = (W - 1400 * S) / 2;
    OY = (H - 600 * S) / 2;
    ctxP.clearRect(0, 0, W, H);
    renderField();
  }

  function PX(lon) { return OX + (lon - 100) * 20 * S; }
  function PY(lat) { return OY + (45 - lat) * 20 * S; }

  /* ══════════ 场渲染 ══════════ */
  function renderField() {
    if (!ctxF || !W) return;
    ctxF.clearRect(0, 0, W, H);
    if (mode === 'flow') drawSpeed(); else drawConc();
  }

  function drawSpeed() {
    var F = OP.field, NX = F.NX, NY = F.NY;
    if (!imgS) {
      imgS = octxS.createImageData(NX, NY);
      var d = imgS.data;
      for (var j = 0; j < NX * NY; j++) {
        var o = j * 4;
        if (!F.MASK[j]) { d[o + 3] = 0; continue; }
        var t = F.SPD[j] / 2.0;
        var c = ramp(RAMP_SPEED, Math.pow(t, 0.75));
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
      }
    }
    octxS.putImageData(imgS, 0, 0);
    ctxF.imageSmoothingEnabled = true;
    ctxF.imageSmoothingQuality = 'high';
    ctxF.drawImage(ofsS, 0, 0, NX, NY, OX, OY, 1400 * S, 600 * S);
  }

  function drawConc() {
    var F = OP.field, TX = F.TX, TY = F.TY;
    var img = octxC.createImageData(TX, TY);
    var d = img.data;
    var conc = OP.model.conc;
    for (var j = 0; j < TX * TY; j++) {
      var ta = F.TARR[j];
      var o = j * 4;
      if (ta < 0 || ta > 9000) { d[o + 3] = 0; continue; }
      var c = OP.model.concAcc(day, ta);
      if (c <= 0) { d[o + 3] = 0; continue; }
      /* 线性映射：浓度直接对应色标位置，不压缩也不夸大。
         c=0.016 → t=1.0（高浓度核心区，亮紫）
         c=0.004 → t=0.25（低浓度边缘，几乎透明）
         未抵达区域 c=0，完全不画 */
      var t = Math.min(1, c / 0.016);
      var col = ramp(RAMP_CONC, t);
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = col[3];
    }
    octxC.putImageData(img, 0, 0);
    ctxF.imageSmoothingEnabled = true;
    ctxF.imageSmoothingQuality = 'high';
    ctxF.drawImage(ofsC, 0, 0, TX, TY, OX, OY, 1400 * S, 600 * S);
  }

  /* ══════════ 粒子 ══════════ */
  function spawn(p) {
    for (var k = 0; k < 24; k++) {
      var lon = 100 + Math.random() * 70;
      var lat = 15 + Math.random() * 30;
      if (OP.field.isWater(lon, lat)) {
        p.x = lon; p.y = lat;
        p.px = lon; p.py = lat;
        p.age = 0;
        p.life = 3.2 + Math.random() * 5.5;
        return;
      }
    }
    p.x = 150; p.y = 30; p.px = 150; p.py = 30; p.age = 0; p.life = 3;
  }

  function spawnAll() {
    parts = [];
    for (var i = 0; i < PN; i++) {
      var p = { x: 0, y: 0, px: 0, py: 0, age: Math.random() * 6, life: 3.2 + Math.random() * 5.5, sp: 0 };
      spawn(p);
      p.age = Math.random() * p.life;
      parts.push(p);
    }
  }

  function step(dt) {
    var F = OP.field;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.px = p.x; p.py = p.y;
      var f = F.sample(p.x, p.y);
      if (f.land || f.s < 1e-4) {
        p.age += dt * 2.2;
      } else {
        p.x += f.u * K * dt;
        p.y += f.v * K * dt;
        p.age += dt;
        p.sp = f.s;
      }
      if (p.age > p.life || p.x < 99 || p.x > 171 || p.y < 14 || p.y > 46) spawn(p);
    }
  }

  /* 核污染扩散色标：深紫 → 紫 → 亮紫 → 紫红 → 粉红
     与洋流粒子的蓝绿色系形成鲜明对比，避免被误读为暖流 */
  var BUCKET = [
    [0.00, 'rgba(90,35,150,0.40)'],
    [0.18, 'rgba(140,55,200,0.54)'],
    [0.42, 'rgba(190,75,230,0.70)'],
    [0.80, 'rgba(230,95,210,0.84)'],
    [1.25, 'rgba(255,120,190,0.94)']
  ];

  function drawParticles() {
    // 拖尾衰减
    ctxP.globalCompositeOperation = 'destination-in';
    ctxP.fillStyle = 'rgba(0,0,0,0.85)';
    ctxP.fillRect(0, 0, W, H);
    ctxP.globalCompositeOperation = 'source-over';

    for (var b = BUCKET.length - 1; b >= 0; b--) {
      var lo = BUCKET[b][0];
      var hi = b === BUCKET.length - 1 ? 99 : BUCKET[b + 1][0];
      ctxP.beginPath();
      var any = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p.sp < lo || p.sp >= hi) continue;
        var x0 = PX(p.px), y0 = PY(p.py), x1 = PX(p.x), y1 = PY(p.y);
        if (Math.abs(x1 - x0) > 40 || Math.abs(y1 - y0) > 40) continue;
        ctxP.moveTo(x0, y0);
        ctxP.lineTo(x1, y1);
        any = true;
      }
      if (any) {
        ctxP.strokeStyle = BUCKET[b][1];
        ctxP.lineWidth = 1.25;
        ctxP.lineCap = 'round';
        ctxP.stroke();
      }
    }
  }

  function frame(now) {
    if (!running) return;
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (!isFinite(dt) || dt <= 0) dt = 0.016;
    dt = Math.min(dt, 0.05);
    step(dt);
    drawParticles();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function destroy() {
    stop();
    window.removeEventListener('resize', onResize);
    host = null; parts = [];
  }

  return {
    init: init, destroy: destroy, stop: stop, start: start,
    setDay: function (d) { day = d; renderField(); },
    setMode: function (m) { mode = m; renderField(); },
    getMode: function () { return mode; },
    renderField: renderField
  };
})();
