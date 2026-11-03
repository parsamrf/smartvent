// Home page interactivity: the control-logic simulator, counters, the simulated
// system-status strip, the animated data-flow diagram with its stage inspector,
// and the offline-recovery demo. The airflow background lives in bg.js.
(() => {
  const $ = (id) => document.getElementById(id);
  const reduced = UI.reduced();

  // ------------------------------------------------------------ hero counters
  document.querySelectorAll("[data-count]").forEach((el) => {
    const to = Number(el.dataset.count);
    el.textContent = "0"; el._v = 0;
    setTimeout(() => UI.countTo(el, to), 350);
  });

  // SMIL animations in the hardware illustrations ignore CSS, so pause them for reduced motion.
  if (reduced) document.querySelectorAll(".hw-art svg").forEach((s) => s.pauseAnimations?.());

  // ------------------------------------------------------------ simulator
  // Same rule the node firmware runs (firmware/node/src/control.c):
  // ON when temp >= 27 or humidity >= 60; OFF when temp < 26.5 and humidity < 57.
  const T_ON = 27, T_OFF = 26.5, H_ON = 60, H_OFF = 57;
  const sim = { mode: "auto", fan: false };

  $("sim-fan").innerHTML = UI.FAN_SVG;
  const simFan = UI.fan($("sim-fan").firstElementChild);

  // Draw the "keeps state" and "turns on" zones on each slider's band.
  function placeBand(id, input, off, on) {
    const lo = Number(input.min), hi = Number(input.max), p = (v) => ((v - lo) / (hi - lo)) * 100;
    const band = $(id);
    const [hyst, over, cur] = band.children;
    hyst.style.left = `${p(off)}%`; hyst.style.width = `${p(on) - p(off)}%`;
    over.style.left = `${p(on)}%`;
    cur.style.left = `${p(Number(input.value))}%`;
  }

  function renderSim() {
    const ti = $("sim-t"), hi = $("sim-h");
    const t = Number(ti.value), h = Number(hi.value);
    $("sim-tv").textContent = `${t.toFixed(1)} °C`;
    $("sim-hv").textContent = `${h} %`;
    UI.rangeFill(ti); UI.rangeFill(hi);
    placeBand("band-t", ti, T_OFF, T_ON);
    placeBand("band-h", hi, H_OFF, H_ON);
    let why;
    if (sim.mode === "auto") {
      const over = t >= T_ON || h >= H_ON;
      const clear = t < T_OFF && h < H_OFF;
      if (over) { sim.fan = true; why = t >= T_ON ? `Temperature reached ${T_ON} °C, so the fan is on.` : `Humidity reached ${H_ON} %, so the fan is on.`; }
      else if (clear) { sim.fan = false; why = "Both readings are comfortably below their limits."; }
      else why = `In the hysteresis band, so the fan keeps its current state (${sim.fan ? "on" : "off"}).`;
    } else {
      why = "Manual override: sensors are ignored until you switch back to Auto.";
    }
    simFan.set(sim.fan);
    $("sim-state").textContent = sim.fan ? "Fan running" : "Fan off";
    $("sim-state").classList.toggle("on", sim.fan);
    $("sim-why").textContent = why;
    $("sim-toggle").hidden = sim.mode !== "manual";
  }

  document.querySelectorAll("#sim [data-mode]").forEach((b) => b.addEventListener("click", () => {
    sim.mode = b.dataset.mode;
    document.querySelectorAll("#sim [data-mode]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    renderSim();
  }));
  $("sim-toggle").addEventListener("click", () => { sim.fan = !sim.fan; renderSim(); });
  ["sim-t", "sim-h"].forEach((id) => $(id).addEventListener("input", renderSim));
  renderSim();

  // Logged-in visitors get a dashboard button instead of "Create an account".
  if (Auth.isLoggedIn()) {
    const cta = $("cta-main");
    cta.href = "dashboard.html";
    cta.querySelector("span").textContent = "Open dashboard";
  }

  // ------------------------------------------------------------ offline demo state
  // Shared by the status strip (gateway buffer) and the offline-recovery demo.
  const od = { online: true, buf: [], pts: [], outages: [], tick: 0, stored: 0, backfilled: 0, valA: 23.2, valB: 25.6, visible: false };

  // ------------------------------------------------------------ system status strip
  // Simulated in the browser: two nodes drifting around their limits and running
  // the same auto rule, a gateway and the cloud. One reading every 5 s, like the nodes.
  const SS_MS = 5000;
  const ss = {
    a: { t: 23.4, h: 46, fan: false, hist: [] },
    b: { t: 26.1, h: 55, fan: false, hist: [] },
    msgs: 18432, start: Date.now(), next: Date.now() + SS_MS,
  };
  const tile = (k) => document.querySelector(`[data-tile="${k}"]`);
  const tv = (k, v) => tile(k).querySelector(`[data-v="${v}"]`);

  function flash(el) {
    el.classList.remove("fresh");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("fresh");
  }

  function stepNode(n, warm) {
    n.t += (Math.random() - 0.5) * 0.5 + (n.fan ? -0.22 : warm);
    n.h += (Math.random() - 0.5) * 1.4 + (n.fan ? -0.6 : warm * 2.5);
    n.t = Math.max(19, Math.min(31, n.t)); n.h = Math.max(35, Math.min(75, n.h));
    if (n.t >= T_ON || n.h >= H_ON) n.fan = true; else if (n.t < T_OFF && n.h < H_OFF) n.fan = false;
    n.hist.push(n.t); if (n.hist.length > 24) n.hist.shift();
  }

  function sparkPath(vals) {
    if (vals.length < 2) return "";
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.6) { lo -= 0.3; hi += 0.3; }
    return vals.map((v, i) => `${i ? "L" : "M"}${((i / (vals.length - 1)) * 118 + 1).toFixed(1)} ${(23 - ((v - lo) / (hi - lo)) * 20).toFixed(1)}`).join("");
  }

  function renderNode(key) {
    const n = ss[key];
    UI.countTo(tv(key, "t"), n.t, 1);
    UI.countTo(tv(key, "h"), n.h, 0);
    tv(key, "spark").setAttribute("d", sparkPath(n.hist));
    tv(key, "fan").textContent = n.fan ? "Fan running · Auto" : "Fan off · Auto";
    tile(key).classList.toggle("fan-on", n.fan);
    flash(tile(key));
  }

  function renderGateway() {
    const off = !od.online;
    tv("gw", "buf").textContent = od.buf.length;
    tv("gw", "net").textContent = off ? "cloud link down" : od.buf.length ? "uploading backlog" : "cloud link up";
    tile("gw").classList.toggle("warn", off);
    tile("cloud").classList.toggle("warn", off);
    tv("cloud", "bf").textContent = od.backfilled;
  }

  function ssTick() {
    stepNode(ss.a, 0.05); stepNode(ss.b, 0.09);
    renderNode("a"); renderNode("b");
    tv("gw", "rssi").textContent = -(56 + Math.round(Math.random() * 12));
    if (od.online) {
      ss.msgs += 2;
      UI.countTo(tv("cloud", "msgs"), ss.msgs);
      tv("cloud", "rtt").textContent = 140 + Math.round(Math.random() * 80);
      flash(tile("cloud"));
    } else tv("cloud", "rtt").textContent = "–";
    renderGateway();
    flash(tile("gw"));
    ss.next = Date.now() + SS_MS;
    const bar = $("ss-bar");
    bar.classList.remove("run"); void bar.offsetWidth; bar.classList.add("run");
  }

  const pad = (n) => String(n).padStart(2, "0");
  function ssClock() {
    const up = Math.floor((Date.now() - ss.start) / 1000); // time since this preview started
    const d = Math.floor(up / 86400), h = Math.floor((up % 86400) / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
    $("ss-up").textContent = `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
    $("ss-next").textContent = Math.max(0, Math.ceil((ss.next - Date.now()) / 1000));
  }
  for (let i = 0; i < 20; i++) { stepNode(ss.a, 0.05); stepNode(ss.b, 0.09); }
  tv("cloud", "msgs")._v = undefined;
  ssTick(); ssClock();
  setInterval(ssTick, SS_MS);
  setInterval(ssClock, 1000);

  // ------------------------------------------------------------ data-flow diagram
  const FLOWS = {
    telemetry: [
      ["The node reads its SHT31 every 5 seconds, runs the auto rule and drives its LED.", ["n-a"]],
      ["It notifies the gateway over Bluetooth LE.", ["n-a", "w-a-gw", "gw"]],
      ["The gateway publishes the reading as JSON to AWS IoT Core over MQTT/TLS.", ["gw", "w-gw-iot", "iot"]],
      ["An IoT rule stores it in DynamoDB: the latest status and a history record.", ["iot", "w-iot-db", "db"]],
      ["Lambda reads it through API Gateway, checking your login token first.", ["db", "w-api-db", "api"]],
      ["The dashboard shows it over HTTPS.", ["api", "w-api-web", "web"]],
    ],
    command: [
      ["You press “Fan on”. The dashboard calls the API with your login token.", ["web"]],
      ["Lambda checks you own that node and that the command is valid.", ["web", "w-api-web", "api"]],
      ["It publishes to this node's own topic on AWS IoT Core.", ["api", "w-iot-api", "iot"]],
      ["IoT Core delivers the command to the gateway over MQTT/TLS.", ["iot", "w-gw-iot", "gw"]],
      ["The gateway finds that node by device ID and writes the command over BLE. The other node never hears it.", ["gw", "w-b-gw", "n-b"]],
      ["The node applies it and reports its new state. The dashboard shows success only after that reply.", ["n-b"]],
    ],
  };

  // Stage inspector content for each block in the diagram.
  const NODE_FACTS = [["Sensor", "Sensirion SHT31 on I²C"], ["Sends", "20-byte BLE notification every 5 s"], ["Control", "Auto rule with hysteresis, runs locally"], ["LEDs", "Fan on · manual mode · gateway link"]];
  const STAGES = {
    "n-a": ["Sensor node · room A", "Node A", "A nice!nano (nRF52840) running Zephyr. It keeps controlling its fan even when nothing else is reachable.", NODE_FACTS],
    "n-b": ["Sensor node · room B", "Node B", "Identical to Node A, with its own device ID. Commands for A never reach B: the gateway writes only to the node that owns the ID.", NODE_FACTS],
    gw: ["Bridge", "ESP32-S3 gateway", "Connects to both nodes as a BLE central and turns their packets into JSON messages for AWS.",
      [["Uplink", "MQTT over mutual TLS, port 8883"], ["Topic", "smartvent/<id>/telemetry"], ["Downlink", "8-byte BLE write to one node"], ["Offline", "Buffers up to 720 readings in RAM"]]],
    iot: ["Message broker", "AWS IoT Core", "Authenticates the gateway by its X.509 certificate and routes every message with topic rules.",
      [["Rules", "Telemetry and backfill into DynamoDB"], ["Commands", "smartvent/<id>/cmd, one topic per node"], ["Security", "Per-device certificate and policy"]]],
    db: ["Storage", "Amazon DynamoDB", "Holds the latest state of each node and every reading ever reported, including recovered ones.",
      [["Latest", "One row per node, never overwritten by backfill"], ["History", "Every reading, tagged live or backfill"], ["Commands", "Status for the Sent → Delivered check"]]],
    api: ["REST API", "API Gateway + Lambda", "The only way into the data. Every request carries your login token and is checked before anything runs.",
      [["Auth", "Amazon Cognito JWT"], ["Ownership", "You can only read and control your own nodes"], ["Output", "Publishes commands back through IoT Core"]]],
    web: ["Front end", "SmartVent web app", "This site. Plain HTML, CSS and JavaScript served by nginx on EC2.",
      [["Transport", "HTTPS with Let's Encrypt, HSTS on"], ["Refresh", "Polls the API every 3 s"], ["Feedback", "Success shown only after the node confirms"]]],
  };

  let flow = "telemetry", step = 0, timer = null, packetRaf = 0, pinned = null, hovered = null;
  const packet = $("packet");

  function showStage(id) {
    const s = STAGES[id];
    if (!s) return;
    $("ins-k").textContent = s[0];
    $("ins-t").textContent = s[1];
    $("ins-p").textContent = s[2];
    $("ins-f").innerHTML = s[3].map(([k, v]) => `<li><b>${UI.esc(k)}</b><span>${UI.esc(v)}</span></li>`).join("");
    document.querySelectorAll(".diagram .stage").forEach((g) => g.classList.toggle("picked", g.id === id));
    const ins = $("inspector");
    ins.classList.remove("swap"); void ins.offsetWidth; ins.classList.add("swap");
  }
  // What the inspector shows when nobody is pointing at a block: the pinned one, or the active step's target.
  function restingStage() {
    if (pinned) return pinned;
    const ids = FLOWS[flow][step][1].filter((id) => !id.startsWith("w-"));
    return ids[ids.length - 1];
  }

  // Move the glowing packet along the active wire, from the step's source box to its target.
  function sendPacket() {
    cancelAnimationFrame(packetRaf);
    const ids = FLOWS[flow][step][1];
    const wireId = ids.find((id) => id.startsWith("w-"));
    if (!wireId || reduced) { packet.setAttribute("opacity", "0"); return; }
    const path = $(wireId), len = path.getTotalLength();
    const b = $(ids[0]).getBBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const p0 = path.getPointAtLength(0), p1 = path.getPointAtLength(len);
    const rev = Math.hypot(p1.x - cx, p1.y - cy) < Math.hypot(p0.x - cx, p0.y - cy);
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1100);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const pt = path.getPointAtLength(len * (rev ? 1 - e : e));
      packet.setAttribute("cx", pt.x); packet.setAttribute("cy", pt.y);
      packet.setAttribute("opacity", k < 0.9 ? "1" : String((1 - k) * 10));
      if (k < 1) packetRaf = requestAnimationFrame(tick);
    };
    packetRaf = requestAnimationFrame(tick);
  }

  function paint() {
    document.querySelectorAll(".diagram svg .lit").forEach((el) => el.classList.remove("lit"));
    FLOWS[flow][step][1].forEach((id) => $(id)?.classList.add("lit"));
    document.querySelectorAll("#flow-list li").forEach((li, i) => {
      li.classList.toggle("active", i === step);
      li.classList.toggle("done", i < step);
      li.firstElementChild.setAttribute("aria-current", i === step ? "step" : "false");
    });
    $("flow-bar").style.width = `${((step + 1) / FLOWS[flow].length) * 100}%`;
    if (!hovered) showStage(restingStage());
    sendPacket();
  }

  function renderList() {
    $("flow-list").innerHTML = FLOWS[flow].map(([text]) => `<li><button type="button">${UI.esc(text)}</button></li>`).join("");
    document.querySelectorAll("#flow-list button").forEach((b, i) => b.addEventListener("click", () => { stop(); pinned = null; step = i; paint(); }));
  }

  function stop() { clearInterval(timer); timer = null; }
  function play() {
    stop();
    pinned = null;
    step = 0; paint();
    if (reduced) return;
    timer = setInterval(() => {
      if (step >= FLOWS[flow].length - 1) return stop();
      step++; paint();
    }, 1800);
  }

  document.querySelectorAll("[data-flow]").forEach((b) => b.addEventListener("click", () => {
    flow = b.dataset.flow;
    document.querySelectorAll("[data-flow]").forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    renderList(); play();
  }));
  $("flow-replay").addEventListener("click", play);

  // Explorer: hover or focus previews a block, click / Enter pins it.
  document.querySelectorAll(".diagram .stage").forEach((g) => {
    const enter = () => { hovered = g.id; showStage(g.id); };
    const leave = () => { if (hovered === g.id) { hovered = null; showStage(restingStage()); } };
    const pick = () => { pinned = g.id; hovered = null; showStage(g.id); };
    g.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") enter(); });
    g.addEventListener("pointerleave", leave);
    g.addEventListener("focus", enter);
    g.addEventListener("blur", leave);
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });

  renderList(); paint();
  // Start the animation the first time the diagram scrolls into view.
  new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) { play(); obs.disconnect(); }
  }, { threshold: 0.4 }).observe(document.querySelector(".diagram"));

  // ------------------------------------------------------------ offline recovery demo
  // One tick = one 5-second reading from each node (sped up to one per second).
  // While offline, readings go into the gateway's RAM buffer instead of the cloud;
  // after reconnecting the buffer is uploaded oldest first, 5 messages per pass.
  const OD_TICK = 1000, OD_FLUSH = 380, OD_WIN = 40, CELLS = 40, CAP = 720;
  const bufEl = $("od-buf");
  bufEl.innerHTML = "<i></i>".repeat(CELLS);
  const cells = [...bufEl.children];
  let autoTimer = null, autoLeft = 0;

  function odReading(t) {
    od.valA += (Math.random() - 0.5) * 0.45 + (24 - od.valA) * 0.05;
    od.valB += (Math.random() - 0.5) * 0.45 + (26 - od.valB) * 0.05;
    return [{ t, v: od.valA, n: "a" }, { t, v: od.valB, n: "b" }];
  }

  function odPhase() { return !od.online ? "offline" : od.buf.length ? "flush" : "live"; }

  function odRenderChart() {
    // Draw in real pixels so dots stay round at any width.
    const chart = $("od-chart");
    const W = Math.max(280, Math.round(chart.clientWidth || 800)), H = 170, now = od.tick, t0 = now - OD_WIN;
    chart.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const X = (t) => 12 + ((t - t0) / OD_WIN) * (W - 24);
    const Y = (v) => 18 + (1 - (v - 22) / 6) * (H - 36);
    const vis = od.pts.filter((p) => p.t >= t0 - 1);
    let s = `<defs><pattern id="od-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" class="od-hb"/><rect width="3" height="8" class="od-hl"/></pattern></defs>`;
    for (const o of od.outages) {
      const a = Math.max(X(o.from), 0), b = X(o.to ?? now);
      if (b < 0) continue;
      s += `<rect class="od-band" x="${a.toFixed(1)}" y="4" width="${Math.max(2, b - a).toFixed(1)}" height="${H - 8}" rx="6"/>`;
      if (b - a > 70) s += `<text class="od-band-t" x="${((a + b) / 2).toFixed(1)}" y="20" text-anchor="middle">${o.to === null ? "offline" : "outage"}</text>`;
    }
    for (const n of ["a", "b"]) {
      const pts = vis.filter((p) => p.n === n).sort((p, q) => p.t - q.t);
      if (pts.length > 1) s += `<path class="od-ln ${n}" d="${pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join("")}"/>`;
      for (const p of pts) {
        const x = X(p.t).toFixed(1), y = Y(p.v).toFixed(1);
        s += p.bf ? `<rect class="od-bf${p.fresh ? " pop" : ""}" x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" transform="rotate(45 ${x} ${y})"/>`
          : `<circle class="od-pt ${n}" cx="${x}" cy="${y}" r="3.6"/>`;
        p.fresh = false;
      }
    }
    s += `<line class="od-now" x1="${W - 12}" x2="${W - 12}" y1="6" y2="${H - 6}"/>`;
    $("od-chart").innerHTML = s;
  }

  function odRender() {
    const phase = odPhase();
    const n = od.buf.length;
    cells.forEach((c, i) => c.classList.toggle("on", i < n));
    bufEl.dataset.more = n > CELLS ? `+${n - CELLS}` : "";
    $("od-count").textContent = n;
    $("od-stored").textContent = od.stored;
    $("od-net").setAttribute("aria-checked", String(od.online));
    $("od-net-l").textContent = od.online ? "online" : "offline";
    $("od").dataset.phase = phase;
    $("od-mqtt").classList.toggle("down", !od.online);
    $("od-mqtt").classList.toggle("flush", phase === "flush");
    $("od-phase").textContent = { live: "Live: readings go straight to the cloud",
      offline: `Offline: ${n} reading${n === 1 ? "" : "s"} waiting in the gateway`,
      flush: `Reconnected: uploading ${n} buffered reading${n === 1 ? "" : "s"}` }[phase];
    document.querySelectorAll("#od-steps li").forEach((li) => li.classList.toggle("on", li.dataset.p === phase));
    odRenderChart();
    renderGateway();
  }

  function odTick() {
    if (!(od.visible || !od.online || od.buf.length) || document.hidden) return;
    od.tick++;
    const rs = odReading(od.tick);
    if (od.online) { rs.forEach((r) => od.pts.push({ ...r, bf: false })); od.stored += 2; }
    else od.buf.push(...rs.slice(0, Math.max(0, CAP - od.buf.length)));
    od.pts = od.pts.filter((p) => p.t >= od.tick - OD_WIN - 2);
    od.outages = od.outages.filter((o) => o.to === null || o.to >= od.tick - OD_WIN);
    odRender();
  }

  function odFlush() {
    if (!od.online || !od.buf.length) return;
    const batch = od.buf.splice(0, 5); // oldest first, 5 per pass, like the gateway
    batch.forEach((r) => od.pts.push({ ...r, bf: true, fresh: true }));
    od.stored += batch.length; od.backfilled += batch.length;
    odRender();
  }

  function setOnline(on) {
    if (od.online === on) return;
    od.online = on;
    if (!on) od.outages.push({ from: od.tick + 0.5, to: null });
    else { const o = od.outages[od.outages.length - 1]; if (o && o.to === null) o.to = od.tick + 0.5; }
    if (on && autoTimer) { clearInterval(autoTimer); autoTimer = null; $("od-auto").disabled = false; $("od-auto").textContent = "Simulate a 15 s outage"; }
    odRender();
  }

  $("od-net").addEventListener("click", () => setOnline(!od.online));
  $("od-auto").addEventListener("click", () => {
    setOnline(false);
    autoLeft = 15;
    const btn = $("od-auto");
    btn.disabled = true; btn.textContent = `Reconnecting in ${autoLeft} s…`;
    autoTimer = setInterval(() => {
      autoLeft--;
      if (autoLeft <= 0) setOnline(true);
      else btn.textContent = `Reconnecting in ${autoLeft} s…`;
    }, 1000);
  });

  // Seed the timeline so it isn't empty, then only run while the demo is on screen.
  for (let i = 0; i < OD_WIN; i++) { od.tick++; odReading(od.tick).forEach((r) => od.pts.push({ ...r, bf: false })); od.stored += 2; }
  odRender();
  addEventListener("resize", () => odRenderChart(), { passive: true });
  new IntersectionObserver((entries) => { od.visible = entries.some((e) => e.isIntersecting); }, { threshold: 0.15 }).observe($("od"));
  setInterval(odTick, OD_TICK);
  setInterval(odFlush, OD_FLUSH);
})();
