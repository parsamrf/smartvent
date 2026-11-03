// Shared micro-interactions: scroll progress bar, button ripples, magnetic
// primary buttons, cursor spotlight + gentle tilt on cards, and heading reveals.
// Everything is decorative: pointer-only effects need a fine pointer, and
// reduced motion keeps only the static parts (progress bar, focus styles).
(() => {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;

  // ------------------------------------------------------------ scroll progress
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  let sp = 0;
  const paintProgress = () => {
    sp = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 8 ? Math.min(1, scrollY / max).toFixed(4) : 0})`;
  };
  addEventListener("scroll", () => { sp ||= requestAnimationFrame(paintProgress); }, { passive: true });
  addEventListener("resize", () => { sp ||= requestAnimationFrame(paintProgress); }, { passive: true });
  paintProgress();

  if (reduced) return;

  // ------------------------------------------------------------ ripples
  // A soft circle expands from the press point. Works for every button style
  // that keeps position: relative (all of them except "all: unset" ones).
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("button, .btn, .nav-links a, .chip-btn");
    if (!b || b.disabled || e.button !== 0) return;
    const cs = getComputedStyle(b);
    if (cs.position === "static") return;
    const r = b.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const wrap = document.createElement("span");
    wrap.className = "rp-wrap";
    wrap.setAttribute("aria-hidden", "true");
    const dot = document.createElement("span");
    dot.className = "rp";
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    wrap.appendChild(dot);
    b.appendChild(wrap);
    setTimeout(() => wrap.remove(), 650);
  });

  if (!fine) return;

  // ------------------------------------------------------------ magnetic buttons
  // Primary calls to action lean a few pixels toward the cursor.
  const magnets = () => document.querySelectorAll(".btn, .nav-links a.cta, #open-add, .empty button");
  const bindMagnet = (el) => {
    if (el._mag) return; el._mag = true;
    el.classList.add("magnetic");
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
      el.style.setProperty("--mgx", `${(x * 5).toFixed(1)}px`);
      el.style.setProperty("--mgy", `${(y * 4).toFixed(1)}px`);
    });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--mgx", "0px"); el.style.setProperty("--mgy", "0px"); });
  };

  // ------------------------------------------------------------ spotlight + tilt
  // .spot cards get a radial highlight at the cursor; .tilt cards also rotate
  // by at most ~3 degrees. Dashboard device cards only get the spotlight.
  const bindSpot = (el) => {
    if (el._spot) return; el._spot = true;
    el.classList.add("spot");
    const tilt = el.matches(".card.lift, .ref-card");
    if (tilt) el.classList.add("tilt");
    let raf = 0, ev = null;
    const paint = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      el.style.setProperty("--mx", `${x.toFixed(0)}px`);
      el.style.setProperty("--my", `${y.toFixed(0)}px`);
      if (tilt) {
        el.style.setProperty("--ry", `${((x / r.width - 0.5) * 5).toFixed(2)}deg`);
        el.style.setProperty("--rx", `${((0.5 - y / r.height) * 4).toFixed(2)}deg`);
      }
    };
    el.addEventListener("pointermove", (e) => { ev = e; raf ||= requestAnimationFrame(paint); });
    el.addEventListener("pointerleave", () => { el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); });
  };

  const scan = () => {
    magnets().forEach(bindMagnet);
    document.querySelectorAll(".card.lift, .ref-card, .hero-card, .stat, .device").forEach(bindSpot);
  };
  scan();
  // Dashboard device cards are appended to #devices after the first API call.
  const devices = document.getElementById("devices");
  if (devices) new MutationObserver(scan).observe(devices, { childList: true });
})();
