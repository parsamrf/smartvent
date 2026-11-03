// Small UI helpers shared by all pages: toasts, confirm dialog, formatting,
// animated counters, fan animation, scroll-reveal, theme and slider styling.
const UI = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => motionQuery.matches;

  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 11v6M12 7h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>',
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
    thermo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/></svg>',
    drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7s6.5 7 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 9.7 12 2.7 12 2.7z"/></svg>',
    node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 7V4M15 7V4M8 13h.01M12 13h4"/></svg>',
    signal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01"/></svg>',
    fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M12 10c-1-4 0-7 3-7 2.5 0 2.5 3.5-1 6M14 12c4-1 7 0 7 3 0 2.5-3.5 2.5-6-1M12 14c1 4 0 7-3 7-2.5 0-2.5-3.5 1-6M10 12c-4 1-7 0-7-3 0-2.5 3.5-2.5 6 1"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  };

  // Fan icon used on the home page and dashboard. Blade rotation is animated
  // by UI.fan() so it spins up and coasts down like a real fan.
  const FAN_SVG = `
    <svg class="fan" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="halo" cx="50" cy="50" r="46"/><circle class="halo" cx="50" cy="50" r="46"/>
      <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" stroke-width="3" opacity="0.35"/>
      <g class="blades" fill="currentColor">
        <path d="M50 50 C46 30 52 12 66 14 C74 16 72 30 62 40 Z"/>
        <path d="M50 50 C70 46 88 52 86 66 C84 74 70 72 60 62 Z"/>
        <path d="M50 50 C54 70 48 88 34 86 C26 84 28 70 38 60 Z"/>
        <path d="M50 50 C30 54 12 48 14 34 C16 26 30 28 40 38 Z"/>
      </g>
      <circle cx="50" cy="50" r="6" fill="var(--surface)" stroke="currentColor" stroke-width="3"/>
    </svg>`;

  // ------------------------------------------------------------ fan physics
  const fans = new Set();
  let fanRaf = 0, fanLast = 0;
  function fanLoop(t) {
    const dt = Math.min(0.05, (t - (fanLast || t)) / 1000);
    fanLast = t;
    let busy = false;
    for (const f of fans) {
      if (!f.el.isConnected) { fans.delete(f); continue; }
      f.speed += (f.target - f.speed) * Math.min(1, dt * (f.target > f.speed ? 1.6 : 0.9));
      if (Math.abs(f.target - f.speed) < 0.002) f.speed = f.target;
      f.angle = (f.angle + f.speed * 540 * dt) % 360;
      f.blades.setAttribute("transform", `rotate(${f.angle.toFixed(2)} 50 50)`);
      if (f.speed > 0 || f.target > 0) busy = true;
    }
    fanRaf = busy ? requestAnimationFrame(fanLoop) : 0;
    if (!busy) fanLast = 0;
  }
  function fan(svg) {
    const f = { el: svg, blades: svg.querySelector(".blades"), angle: Math.random() * 90, speed: 0, target: 0 };
    f.blades.setAttribute("transform", `rotate(${f.angle} 50 50)`);
    fans.add(f);
    return {
      set(on) {
        svg.classList.toggle("on", !!on);
        f.target = on && !reduced() ? 1 : 0;
        if (reduced()) f.speed = 0;
        if (!fanRaf && (f.target || f.speed)) fanRaf = requestAnimationFrame(fanLoop);
      },
    };
  }

  // ------------------------------------------------------------ counters
  // Animates el's text from its previous value to `to`. Stores the value on the element.
  function countTo(el, to, decimals = 0) {
    if (to === null || to === undefined || Number.isNaN(Number(to))) { el._v = undefined; el.textContent = "–"; return; }
    to = Number(to);
    const from = el._v;
    el._v = to;
    cancelAnimationFrame(el._raf);
    if (from === undefined || reduced() || from === to) { el.textContent = to.toFixed(decimals); return; }
    const t0 = performance.now(), dur = 700;
    const stepFn = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (from + (to - from) * e).toFixed(decimals);
      if (k < 1) el._raf = requestAnimationFrame(stepFn);
    };
    el._raf = requestAnimationFrame(stepFn);
  }

  // ------------------------------------------------------------ toasts
  function toast(text, kind = "info", ms = 4500) {
    let box = document.getElementById("toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    const t = document.createElement("div");
    t.className = `toast ${kind}`;
    t.style.setProperty("--ms", `${ms}ms`);
    const ico = { ok: ICON.check, error: ICON.x, warn: ICON.warn }[kind] || ICON.info;
    t.innerHTML = `<span class="t-ico" aria-hidden="true">${ico}</span><span class="t-text"></span>
      <button type="button" class="ghost t-close" aria-label="Dismiss notification">×</button><i class="t-bar"></i>`;
    t.querySelector(".t-text").textContent = text;
    const remove = () => {
      if (t._gone) return; t._gone = true;
      if (reduced()) return t.remove();
      t.classList.add("out");
      setTimeout(() => t.remove(), 300);
    };
    t.querySelector(".t-close").addEventListener("click", remove);
    // Timer pauses while hovered, matching the paused progress bar.
    let left = ms, start = Date.now(), timer = setTimeout(remove, ms);
    t.addEventListener("mouseenter", () => { clearTimeout(timer); left -= Date.now() - start; });
    t.addEventListener("mouseleave", () => { start = Date.now(); timer = setTimeout(remove, Math.max(800, left)); });
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild.remove();
  }

  // Promise-based replacement for window.confirm() using a <dialog>.
  function confirm({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.innerHTML = `<h2>${esc(title)}</h2><p class="muted">${esc(message)}</p>
        <div class="actions"><button class="secondary" value="no">Cancel</button>
        <button class="${danger ? "danger" : ""}" value="yes">${esc(confirmLabel)}</button></div>`;
      d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
      d.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => d.close(b.value)));
      d.addEventListener("click", (e) => { if (e.target === d) d.close("no"); });
      document.body.appendChild(d);
      d.showModal();
    });
  }

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 5) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Copied to clipboard", "ok", 1800); }
    catch { toast("Could not copy", "warn", 2500); }
  }

  // ------------------------------------------------------------ scroll reveal
  let revealObs = null;
  function reveal(root = document) {
    const els = root.querySelectorAll(".reveal:not(.in)");
    if (!els.length) return;
    if (reduced() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    document.documentElement.classList.add("js-reveal");
    revealObs ||= new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); revealObs.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e) => revealObs.observe(e));
  }

  // ------------------------------------------------------------ range slider fill
  function rangeFill(input) {
    const p = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
    input.style.setProperty("--p", `${p}%`);
  }

  // ------------------------------------------------------------ password show/hide
  function pwToggle(root = document) {
    root.querySelectorAll('input[type="password"]').forEach((inp) => {
      if (inp.parentElement.classList.contains("pw-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "pw-wrap";
      inp.before(wrap); wrap.appendChild(inp);
      const b = document.createElement("button");
      b.type = "button"; b.className = "ghost pw-show"; b.textContent = "Show";
      b.setAttribute("aria-label", `Show ${inp.labels?.[0]?.textContent || "password"}`);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        b.textContent = show ? "Hide" : "Show";
        b.setAttribute("aria-pressed", String(show));
      });
      wrap.appendChild(b);
    });
  }

  // ------------------------------------------------------------ theme
  // "auto" follows the OS. A change fires a "sv:theme" event so canvases can repaint.
  const THEME_KEY = "sv.theme";
  function getTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } }
  function setTheme(t) {
    try { if (t === "auto") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
    if (t === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event("sv:theme"));
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (getTheme() === "auto") window.dispatchEvent(new Event("sv:theme"));
  });
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  return { esc, toast, confirm, ago, copy, FAN_SVG, ICON, fan, countTo, reveal, rangeFill, pwToggle, getTheme, setTheme, cssVar, reduced };
})();
