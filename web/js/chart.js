// History chart for the dashboard: a small canvas renderer (no library).
// Temperature and humidity get their own panel (one y-scale each) on a shared
// time axis, with a synced crosshair + tooltip, dashed threshold lines, and
// readings recovered after an outage ("backfill") marked as hollow diamonds on
// a hatched band. Keyboard: focus the chart, then Left/Right (Shift = x10),
// Home/End, Escape.
const SVChart = (() => {
  const PAD = { l: 42, r: 12, t: 4, b: 22 };
  const TITLE = 18, GAP = 16;
  const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720].map((m) => m * 60000);

  function niceTicks(lo, hi, count) {
    const raw = (hi - lo) / count || 1;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let v = start; v <= end + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { lo: start, hi: end, ticks, step };
  }
  const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const alpha = (hex, a) => {
    const m = hex.replace("#", "");
    if (m.length !== 6) return hex;
    const n = parseInt(m, 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  class Chart {
    // series: [{ key, label, unit, color: "--css-var", decimals }]
    constructor(box, { series, label }) {
      this.box = box;
      this.series = series;
      box.innerHTML = `<canvas tabindex="0" role="img"></canvas><div class="chart-tip" aria-hidden="true"></div><p class="sr-only" aria-live="polite"></p>`;
      this.canvas = box.querySelector("canvas");
      this.canvas.setAttribute("aria-label", `${label}. Focus and use the arrow keys to read individual values.`);
      this.tip = box.querySelector(".chart-tip");
      this.live = box.querySelector(".sr-only");
      this.ctx = this.canvas.getContext("2d");
      this.items = []; this.from = Date.now() - 3600000; this.to = Date.now(); this.thr = {};
      this.hover = null; this.revealK = 1; this.loaded = false;
      this.readColors();

      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(box);
      this.onTheme = () => { this.readColors(); this.draw(); };
      addEventListener("sv:theme", this.onTheme);

      const c = this.canvas;
      c.addEventListener("pointermove", (e) => this.pointer(e));
      c.addEventListener("pointerdown", (e) => this.pointer(e));
      c.addEventListener("pointerleave", () => { if (document.activeElement !== c) this.setHover(null); });
      c.addEventListener("blur", () => this.setHover(null));
      c.addEventListener("focus", () => { if (this.hover === null && this.items.length) this.setHover(this.items.length - 1, true); });
      c.addEventListener("keydown", (e) => this.key(e));
    }

    readColors() {
      const v = UI.cssVar;
      this.col = {
        text: v("--text"), muted: v("--muted"), faint: v("--faint"), grid: v("--border"), surface: v("--surface"),
        backfill: v("--backfill"), font: getComputedStyle(document.body).fontFamily,
      };
      this.series.forEach((s) => { s.c = v(s.color); });
      this.hatch = null;
    }

    destroy() { this.ro.disconnect(); removeEventListener("sv:theme", this.onTheme); }

    // items: [{ ts, temperature, humidity, backfill }]
    setData(items) {
      this.items = items.slice().sort((a, b) => a.ts - b.ts);
      if (this.hover !== null) this.hover = Math.min(this.hover, this.items.length - 1);
      if (!this.loaded && this.items.length) {
        this.loaded = true;
        if (!UI.reduced()) this.animateIn();
      }
      this.draw();
      if (this.hover !== null) this.showTip();
    }

    setView(from, to, thresholds) {
      this.from = from; this.to = to; this.thr = thresholds || {};
      this.draw();
    }

    animateIn() {
      const t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 900);
        this.revealK = 1 - Math.pow(1 - k, 3);
        this.draw();
        if (k < 1) requestAnimationFrame(tick);
      };
      this.revealK = 0;
      requestAnimationFrame(tick);
    }

    resize() {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const w = this.box.clientWidth, h = this.box.clientHeight;
      if (!w || !h) return;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.draw();
    }

    // ------------------------------------------------------------ geometry
    layout() {
      const { w, h } = this;
      const plotL = PAD.l, plotR = w - PAD.r, pw = Math.max(10, plotR - plotL);
      const ph = Math.max(20, (h - PAD.t - PAD.b - GAP - 2 * TITLE) / 2);
      const tops = [PAD.t + TITLE, PAD.t + TITLE + ph + GAP + TITLE];
      return { plotL, plotR, pw, ph, tops };
    }
    x(ts, L) { return L.plotL + ((ts - this.from) / (this.to - this.from || 1)) * L.pw; }

    domain(s) {
      const vals = [];
      for (const it of this.items) if (it[s.key] !== undefined && it.ts >= this.from) vals.push(it[s.key]);
      if (this.thr[s.key] !== undefined) vals.push(Number(this.thr[s.key]));
      if (!vals.length) return niceTicks(s.key === "humidity" ? 40 : 20, s.key === "humidity" ? 70 : 30, 3);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      const pad = Math.max((hi - lo) * 0.12, s.key === "humidity" ? 2 : 0.5);
      return niceTicks(lo - pad, hi + pad, 3);
    }

    hatchPattern() {
      if (this.hatch) return this.hatch;
      const p = document.createElement("canvas");
      // Drawn in CSS pixels: the canvas transform already applies devicePixelRatio.
      const n = 8;
      p.width = p.height = n;
      const g = p.getContext("2d");
      g.fillStyle = alpha(this.col.backfill, 0.08); g.fillRect(0, 0, n, n);
      g.strokeStyle = alpha(this.col.backfill, 0.3); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, n); g.lineTo(n, 0); g.moveTo(-n / 2, n / 2); g.lineTo(n / 2, -n / 2); g.moveTo(n / 2, n * 1.5); g.lineTo(n * 1.5, n / 2); g.stroke();
      this.hatch = this.ctx.createPattern(p, "repeat");
      return this.hatch;
    }

    // ------------------------------------------------------------ drawing
    draw() {
      if (!this.w) return;
      const { ctx, col } = this;
      const L = this.layout();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      ctx.font = `11px ${col.font}`;
      ctx.textBaseline = "middle";

      const vis = this.items.filter((i) => i.ts >= this.from - 60000);
      const bottom = L.tops[1] + L.ph;

      // Outage bands: consecutive recovered readings.
      const dts = [];
      for (let i = 1; i < vis.length; i++) dts.push(vis[i].ts - vis[i - 1].ts);
      dts.sort((a, b) => a - b);
      const med = dts.length ? dts[dts.length >> 1] : 30000;
      const gapMs = Math.max(med * 6, 60000);
      let run = null;
      const bands = [];
      vis.forEach((it, i) => {
        if (it.backfill) { if (!run) run = { a: it.ts, b: it.ts }; else run.b = it.ts; }
        if (run && (!it.backfill || i === vis.length - 1)) { bands.push(run); run = null; }
      });
      ctx.save();
      ctx.beginPath(); ctx.rect(L.plotL, 0, L.pw, this.h); ctx.clip();
      for (const b of bands) {
        const xa = this.x(b.a - med / 2, L), xb = this.x(b.b + med / 2, L);
        ctx.fillStyle = this.hatchPattern();
        ctx.fillRect(xa, L.tops[0], Math.max(3, xb - xa), bottom - L.tops[0]);
        if (xb - xa > 58) {
          ctx.fillStyle = col.muted; ctx.textAlign = "center";
          ctx.fillText("Recovered", (xa + xb) / 2, L.tops[0] + 9);
        }
      }
      ctx.restore();

      this.series.forEach((s, si) => this.drawPanel(s, L, L.tops[si], vis, gapMs));

      // Shared time axis.
      const span = this.to - this.from;
      const step = TIME_STEPS.find((t) => span / t <= Math.max(2, Math.floor(L.pw / 80))) || TIME_STEPS[TIME_STEPS.length - 1];
      ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const tz = new Date().getTimezoneOffset() * 60000;
      for (let t = Math.ceil((this.from - tz) / step) * step + tz; t <= this.to; t += step) {
        const xx = this.x(t, L);
        if (xx < L.plotL + 14 || xx > L.plotR - 14) continue;
        ctx.fillText(hhmm(t), xx, this.h - 6);
        ctx.strokeStyle = alpha(col.grid.startsWith("#") ? col.grid : "#888888", 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, bottom); ctx.lineTo(Math.round(xx) + 0.5, bottom + 4); ctx.stroke();
      }

      if (!vis.length) {
        ctx.fillStyle = col.muted; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `13px ${col.font}`;
        ctx.fillText(this.loaded ? "No readings in this time range yet." : "Loading history…", L.plotL + L.pw / 2, this.h / 2);
      }

      // Crosshair across both panels.
      if (this.hover !== null && this.items[this.hover]) {
        const it = this.items[this.hover];
        const xx = Math.round(this.x(it.ts, L)) + 0.5;
        ctx.strokeStyle = col.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(xx, L.tops[0]); ctx.lineTo(xx, bottom); ctx.stroke();
        ctx.setLineDash([]);
        this.series.forEach((s, si) => {
          if (it[s.key] === undefined) return;
          const d = this.domain(s);
          const yy = L.tops[si] + L.ph - ((it[s.key] - d.lo) / (d.hi - d.lo)) * L.ph;
          ctx.beginPath(); ctx.arc(xx, yy, 5, 0, Math.PI * 2);
          ctx.fillStyle = it.backfill ? col.surface : s.c; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = it.backfill ? col.backfill : col.surface; ctx.stroke();
        });
      }
    }

    drawPanel(s, L, top, vis, gapMs) {
      const { ctx, col } = this;
      const d = this.domain(s);
      const y = (v) => top + L.ph - ((v - d.lo) / (d.hi - d.lo)) * L.ph;

      // Title (text ink, colored swatch carries identity).
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillStyle = s.c; ctx.fillRect(L.plotL, top - TITLE / 2 - 1, 12, 3);
      ctx.fillStyle = col.text; ctx.font = `600 11.5px ${col.font}`;
      ctx.fillText(`${s.label} (${s.unit})`, L.plotL + 18, top - TITLE / 2);
      ctx.font = `11px ${col.font}`;

      // Grid + y labels.
      ctx.lineWidth = 1;
      for (const t of d.ticks) {
        const yy = Math.round(y(t)) + 0.5;
        ctx.strokeStyle = col.grid; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(L.plotL, yy); ctx.lineTo(L.plotR, yy); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = col.muted; ctx.textAlign = "right";
        ctx.fillText(d.step < 1 ? t.toFixed(1) : String(Math.round(t)), L.plotL - 7, yy);
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(L.plotL, top - 2, L.pw * this.revealK, L.ph + 4); ctx.clip();

      // Threshold: faint "over" zone + dashed line.
      const thr = this.thr[s.key];
      if (thr !== undefined) {
        const ty = y(Number(thr));
        ctx.fillStyle = alpha(s.c, 0.05);
        ctx.fillRect(L.plotL, top, L.pw, Math.max(0, ty - top));
        ctx.strokeStyle = s.c; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(L.plotL, Math.round(ty) + 0.5); ctx.lineTo(L.plotR, Math.round(ty) + 0.5); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }

      // Line + soft area, broken across gaps with no data.
      const pts = vis.filter((i) => i[s.key] !== undefined);
      const segs = [];
      let cur = [];
      pts.forEach((p, i) => {
        if (i && p.ts - pts[i - 1].ts > gapMs) { segs.push(cur); cur = []; }
        cur.push(p);
      });
      if (cur.length) segs.push(cur);
      const grad = ctx.createLinearGradient(0, top, 0, top + L.ph);
      grad.addColorStop(0, alpha(s.c, 0.22)); grad.addColorStop(1, alpha(s.c, 0));
      for (const seg of segs) {
        ctx.beginPath();
        seg.forEach((p, i) => { const xx = this.x(p.ts, L), yy = y(p[s.key]); i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); });
        ctx.strokeStyle = s.c; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
        ctx.lineTo(this.x(seg[seg.length - 1].ts, L), top + L.ph);
        ctx.lineTo(this.x(seg[0].ts, L), top + L.ph);
        ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        if (seg.length === 1) { ctx.beginPath(); ctx.arc(this.x(seg[0].ts, L), y(seg[0][s.key]), 2.5, 0, 7); ctx.fillStyle = s.c; ctx.fill(); }
      }

      // Recovered readings: hollow diamonds (shape, not only color).
      const bf = pts.filter((p) => p.backfill);
      if (bf.length && bf.length < 400) {
        ctx.lineWidth = 1.6; ctx.strokeStyle = col.backfill; ctx.fillStyle = col.surface;
        for (const p of bf) {
          const xx = this.x(p.ts, L), yy = y(p[s.key]), r = 4;
          ctx.beginPath(); ctx.moveTo(xx, yy - r); ctx.lineTo(xx + r, yy); ctx.lineTo(xx, yy + r); ctx.lineTo(xx - r, yy); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();

      // Threshold label, right-aligned above its line.
      if (thr !== undefined) {
        const ty = y(Number(thr));
        const txt = `limit ${Number(thr).toFixed(s.decimals)}`;
        ctx.font = `600 10.5px ${col.font}`;
        const tw = ctx.measureText(txt).width + 10;
        const ly = Math.max(top + 7, Math.min(top + L.ph - 7, ty - 9));
        ctx.fillStyle = col.surface; ctx.globalAlpha = 0.85;
        ctx.fillRect(L.plotR - tw - 2, ly - 7, tw, 14);
        ctx.globalAlpha = 1; ctx.fillStyle = col.muted; ctx.textAlign = "right";
        ctx.fillText(txt, L.plotR - 7, ly);
        ctx.font = `11px ${col.font}`;
      }

      // Latest value marker.
      const last = pts[pts.length - 1];
      if (last && this.revealK === 1 && this.hover === null) {
        const xx = this.x(last.ts, L), yy = y(last[s.key]);
        ctx.beginPath(); ctx.arc(xx, yy, 6, 0, 7); ctx.fillStyle = alpha(s.c, 0.2); ctx.fill();
        ctx.beginPath(); ctx.arc(xx, yy, 3.5, 0, 7); ctx.fillStyle = s.c; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = col.surface; ctx.stroke();
      }
    }

    // ------------------------------------------------------------ interaction
    nearest(ts) {
      const a = this.items;
      if (!a.length) return null;
      let lo = 0, hi = a.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].ts < ts) lo = m + 1; else hi = m; }
      if (lo > 0 && Math.abs(a[lo - 1].ts - ts) < Math.abs(a[lo].ts - ts)) lo--;
      return a[lo].ts < this.from - 60000 ? null : lo;
    }

    pointer(e) {
      if (!this.items.length) return;
      const r = this.canvas.getBoundingClientRect();
      const L = this.layout();
      const mx = e.clientX - r.left;
      if (mx < L.plotL - 10 || mx > L.plotR + 10) return this.setHover(null);
      const ts = this.from + ((mx - L.plotL) / L.pw) * (this.to - this.from);
      this.setHover(this.nearest(ts));
    }

    key(e) {
      const n = this.items.length;
      if (!n) return;
      const first = Math.max(0, this.nearest(this.from) ?? 0);
      let i = this.hover ?? n - 1;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") i = Math.max(first, i - step);
      else if (e.key === "ArrowRight") i = Math.min(n - 1, i + step);
      else if (e.key === "Home") i = first;
      else if (e.key === "End") i = n - 1;
      else if (e.key === "Escape") { this.setHover(null); return; }
      else return;
      e.preventDefault();
      this.setHover(i, true);
    }

    setHover(i, announce = false) {
      if (i === this.hover && !announce) return;
      this.hover = i;
      this.draw();
      if (i === null) { this.tip.classList.remove("show"); return; }
      this.showTip();
      if (announce) this.live.textContent = this.describe(this.items[i]);
    }

    describe(it) {
      const parts = this.series.map((s) => `${s.label} ${it[s.key] === undefined ? "no reading" : `${Number(it[s.key]).toFixed(s.decimals)} ${s.unit}`}`);
      return `${new Date(it.ts).toLocaleTimeString()}: ${parts.join(", ")}${it.backfill ? ", recovered after an outage" : ""}`;
    }

    showTip() {
      const it = this.items[this.hover];
      if (!it) return;
      const L = this.layout();
      this.tip.innerHTML = `<div class="t">${UI.esc(new Date(it.ts).toLocaleTimeString())}</div>` +
        this.series.map((s) => `<div class="r"><i style="background:${s.c}"></i>${UI.esc(s.label)}<b>${it[s.key] === undefined ? "–" : `${Number(it[s.key]).toFixed(s.decimals)} ${UI.esc(s.unit)}`}</b></div>`).join("") +
        (it.backfill ? `<div class="bf"><span class="lg-diamond"></span>Recovered after an outage</div>` : "");
      const xx = this.x(it.ts, L);
      const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      let left = xx + 14;
      if (left + tw > this.w) left = xx - tw - 14;
      left = Math.max(0, left);
      const top = Math.max(0, Math.min(this.h - th, L.tops[0] + L.ph - th / 2));
      this.tip.style.transform = `translate(${left}px, ${top}px)`;
      this.tip.classList.add("show");
    }
  }

  return Chart;
})();
