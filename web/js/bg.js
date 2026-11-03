// Live background shared by every page: soft colored glows plus thin airflow
// lines drifting through a flow field, nudged by the pointer and by scrolling.
//
// - One fixed, full-viewport canvas behind the content (pointer-events: none).
// - Particle count scales with the viewport area; the device pixel ratio is capped.
// - Pauses while the tab is hidden; reduced motion gets the static gradient only.
// - <body data-bg="calm"> (dashboard, assistant) lowers the intensity.
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const calm = document.body.dataset.bg === "calm";

  // Glow layer: two large blurred blobs, moved with compositor-only transforms.
  const glow = document.createElement("div");
  glow.className = "sv-glow";
  glow.setAttribute("aria-hidden", "true");
  glow.innerHTML = "<i></i><i></i><i></i>";
  document.body.prepend(glow);
  if (reduced) return;

  const c = document.createElement("canvas");
  c.className = "sv-bg";
  c.setAttribute("aria-hidden", "true");
  glow.after(c);
  const ctx = c.getContext("2d");

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let W = 0, H = 0, parts = [], colors = [], alpha = 1, raf = 0, last = 0, t = 0;
  const mouse = { x: -1e4, y: -1e4, tx: 0, ty: 0, gx: 0, gy: 0 };
  let scrollV = 0, lastScroll = scrollY;

  function readColors() {
    colors = [css("--accent"), css("--blue")];
    const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
    // Dark backgrounds show thin lines more strongly, so they get a little less alpha.
    alpha = (dark ? 0.85 : 1) * (calm ? 0.45 : 1);
  }

  const spawn = (anywhere) => ({
    x: anywhere ? Math.random() * W : -20 - Math.random() * 80, y: Math.random() * H,
    v: 0.4 + Math.random() * 0.8, w: 0.6 + Math.random() * 1.2, c: Math.random() < 0.68 ? 0 : 1, trail: [],
  });

  function resize() {
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // ~1 particle per 14k px² on the home page, half that on calm pages; capped for big screens.
    const n = Math.round(Math.min(calm ? 45 : 110, (W * H) / (calm ? 30000 : 14000)));
    while (parts.length < n) parts.push(spawn(true));
    parts.length = n;
  }

  function frame(now) {
    const dt = Math.min(2.5, (now - (last || now)) / 16.67); // in 60 fps frames
    last = now;
    t += dt * 16.67;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    scrollV *= Math.pow(0.9, dt);
    for (const p of parts) {
      const a = Math.sin(p.y * 0.005 + t * 0.00022) * 0.5 + Math.cos(p.x * 0.0035 - t * 0.00018) * 0.35;
      let vx = Math.cos(a) * p.v * 1.4, vy = Math.sin(a) * p.v * 1.4 - scrollV * 0.25 * p.w;
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 19600) { const f = (1 - d2 / 19600) * 2.4, d = Math.sqrt(d2) || 1; vx += (dx / d) * f; vy += (dy / d) * f; }
      p.x += vx * dt; p.y += vy * dt;
      const tr = p.trail;
      tr.push(p.x, p.y);
      if (tr.length > 32) tr.splice(0, 2);
      if (p.x > W + 30 || p.y < -60 || p.y > H + 60) { Object.assign(p, spawn(false)); continue; }
      if (tr.length < 6) continue;
      ctx.beginPath();
      ctx.moveTo(tr[0], tr[1]);
      for (let i = 2; i < tr.length; i += 2) ctx.lineTo(tr[i], tr[i + 1]);
      ctx.strokeStyle = colors[p.c];
      ctx.globalAlpha = (0.12 + p.w * 0.07) * alpha;
      ctx.lineWidth = p.w;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Glows drift slowly on their own and lean a little toward the pointer.
    mouse.gx += (mouse.tx - mouse.gx) * 0.04 * dt;
    mouse.gy += (mouse.ty - mouse.gy) * 0.04 * dt;
    const s = t * 0.00008;
    glow.style.setProperty("--g1", `translate3d(${(Math.sin(s) * 40 + mouse.gx * 30).toFixed(1)}px, ${(Math.cos(s * 1.3) * 30 + mouse.gy * 24).toFixed(1)}px, 0)`);
    glow.style.setProperty("--g2", `translate3d(${(Math.cos(s * 0.9) * 50 - mouse.gx * 26).toFixed(1)}px, ${(Math.sin(s * 1.1) * 36 - mouse.gy * 20).toFixed(1)}px, 0)`);
    glow.style.setProperty("--g3", `translate3d(${(Math.sin(s * 0.7 + 2) * 60).toFixed(1)}px, ${(Math.cos(s * 0.8) * 40 + mouse.gy * 16).toFixed(1)}px, 0)`);

    raf = document.hidden ? 0 : requestAnimationFrame(frame);
  }
  const start = () => { if (!raf && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };

  readColors(); resize();
  addEventListener("resize", resize, { passive: true });
  addEventListener("sv:theme", () => requestAnimationFrame(readColors));
  document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else start(); });
  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    mouse.x = e.clientX; mouse.y = e.clientY;
    mouse.tx = e.clientX / W - 0.5; mouse.ty = e.clientY / H - 0.5;
  }, { passive: true });
  document.addEventListener("pointerleave", () => { mouse.x = mouse.y = -1e4; });
  addEventListener("scroll", () => {
    const d = scrollY - lastScroll; lastScroll = scrollY;
    scrollV = Math.max(-30, Math.min(30, scrollV + d * 0.15));
  }, { passive: true });
  start();
})();
