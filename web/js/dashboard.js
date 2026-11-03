// Dashboard: one card per registered node with its latest *reported* state,
// controls, threshold sliders and a history chart.
//
// Command feedback: after a command is sent the card shows a progress tracker
// (Sent -> Delivered -> Confirmed). "Confirmed" appears only once the node's own
// telemetry (a new sequence number) reports the requested state, so the UI never
// assumes a command worked. Delivery failures reported by the gateway (node
// offline, BLE write failed) and timeouts are shown as errors.
(() => {
  const POLL_MS = 3000;
  const ONLINE_WINDOW_MS = 30000;
  const CONFIRM_TIMEOUT_MS = 20000;
  const DEFAULTS = { tempOn: 27, humOn: 60, aqOn: 1500 };
  const TEMP_RANGE = [0, 50];
  const HUM_RANGE = [0, 100];
  const TREND_WINDOW_MS = 10 * 60000;
  const SPARK_WINDOW_MS = 30 * 60000;

  const $ = (id) => document.getElementById(id);
  const container = $("devices");
  const cards = new Map(); // deviceId -> card state
  let firstLoad = true;
  let rangeMinutes = Number(sessionStorageGet("sv.range")) || 60;

  function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } }

  const esc = UI.esc;
  const num = (v, d = 1) => (v === undefined || v === null ? "–" : Number(v).toFixed(d));
  const pct = (v, [lo, hi]) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const tsOf = (l) => Number(l?.ts || l?.receivedAt || 0);

  document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = UI.ICON[el.dataset.ico]; });

  // 270-degree ring gauge; the arc and the threshold tick use pathLength 100.
  const RING = (cls) => `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <path class="trk" d="M20.3 79.7 A42 42 0 1 1 79.7 79.7" pathLength="100"/>
      <path class="arc" data-f="${cls}-arc" d="M20.3 79.7 A42 42 0 1 1 79.7 79.7" pathLength="100" stroke-dasharray="0 100"/>
      <line class="tick" data-f="${cls}-tick" x1="24.5" y1="75.5" x2="15.4" y2="84.6"/>
    </svg>`;

  // ---------------------------------------------------------------- room identity
  // Each card gets a small room icon and a color so short names like "Bedroom"
  // and "Kitchen" are easy to tell apart. Known room words pick a fixed icon and
  // hue; anything else gets a hue from a hash of the name.
  const ROOM_PATH = {
    bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 15h18M3 18v2M21 18v2"/><path d="M7 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/>',
    kitchen: '<path d="M4 11h16v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z"/><path d="M2 11h20M9 7c0-1.5 1-2 1-3.5M13 7c0-1.5 1-2 1-3.5"/>',
    living: '<path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v4H3zM5 17v2M19 17v2"/>',
    bath: '<path d="M3 12h18v2a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/>',
    office: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    garage: '<path d="M3 20V9l9-5 9 5v11"/><path d="M7 20v-7h10v7M7 16h10"/>',
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10M10 20v-6h4v6"/>',
  };
  const ROOMS = [
    [/bed|sleep|nursery|guest/i, "bed", 265], [/kitchen|cook|dining|pantry/i, "kitchen", 150],
    [/living|lounge|family|\bden\b/i, "living", 215], [/bath|shower|toilet|\bwc\b|laundry/i, "bath", 190],
    [/office|study|desk|\blab\b/i, "office", 235], [/garage|basement|attic|\bshed\b|workshop/i, "garage", 330],
  ];
  const HUES = [168, 215, 265, 335, 38, 145, 235, 190];
  function roomOf(name) {
    const hit = ROOMS.find(([re]) => re.test(name || ""));
    if (hit) return { icon: hit[1], hue: hit[2] };
    let h = 2166136261;
    for (const ch of String(name || "")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return { icon: "home", hue: HUES[(h >>> 0) % HUES.length] };
  }
  function paintRoom(card, name) {
    if (card.roomName === name) return;
    card.roomName = name;
    const { icon, hue } = roomOf(name);
    card.el.style.setProperty("--node-h", hue);
    card.q("room").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ROOM_PATH[icon]}</svg>`;
  }

  // ---------------------------------------------------------------- card DOM

  function createCard(device, index) {
    const el = document.createElement("article");
    el.className = "card device";
    el.style.animationDelay = `${Math.min(index, 4) * 90}ms`;
    const uid = device.deviceId.replace(/[^a-z0-9-]/gi, "");
    el.setAttribute("aria-labelledby", `nm-${uid}`);
    el.innerHTML = `
      <div class="device-head">
        <div class="fan-badge" data-f="fan-badge">${UI.FAN_SVG}</div>
        <div class="dh-title">
          <div class="dh-name"><span class="room-ico" data-f="room" aria-hidden="true"></span><h2 data-f="name" id="nm-${uid}"></h2></div>
          <div class="idline"><span class="mono">${esc(device.deviceId)}</span>
            <button class="ghost" data-f="copy" title="Copy device ID" aria-label="Copy device ID" style="padding:2px 6px">${UI.ICON.copy}</button></div>
        </div>
        <div class="dh-right">
          <span class="pill" data-f="pill"><i class="dot"></i><span>No data</span></span>
          <span class="seen" data-f="seen"></span>
        </div>
      </div>
      <div class="device-body">
        <div class="notice alert warn" data-f="notice"></div>

        <div class="gauges">
          <div class="gauge temp" data-f="temp-g" role="group" aria-label="Temperature">
            <div class="ring">${RING("temp")}<div class="center"><span class="v" data-f="temp">–</span><span class="u">°C</span></div></div>
            <div class="g-side">
              <span class="k">Temperature <span class="over-tag">· over limit</span></span>
              <span class="trend" data-f="temp-trend">${UI.ICON.trend}<span>–</span></span>
              <svg class="spark" data-f="temp-spark" aria-hidden="true"></svg>
              <span class="thr"><span data-f="temp-thr"></span></span>
            </div>
          </div>
          <div class="gauge hum" data-f="hum-g" role="group" aria-label="Humidity">
            <div class="ring">${RING("hum")}<div class="center"><span class="v" data-f="hum">–</span><span class="u">% RH</span></div></div>
            <div class="g-side">
              <span class="k">Humidity <span class="over-tag">· over limit</span></span>
              <span class="trend" data-f="hum-trend">${UI.ICON.trend}<span>–</span></span>
              <svg class="spark" data-f="hum-spark" aria-hidden="true"></svg>
              <span class="thr"><span data-f="hum-thr"></span></span>
            </div>
          </div>
        </div>

        <div class="status-row">
          <div class="fan-state">
            <div class="label" data-f="fan-label">–</div><div class="sublabel" data-f="mode-label">–</div>
          </div>
          <div class="controls">
            <div><span class="ctl-label" id="ml-${uid}">Mode</span>
              <div class="seg" role="group" aria-labelledby="ml-${uid}">
                <button type="button" data-cmd="auto" aria-pressed="false">Auto</button><button type="button" data-cmd="manual" aria-pressed="false">Manual</button>
              </div></div>
            <div><span class="ctl-label" id="fl-${uid}">Fan (manual)</span>
              <div class="seg" role="group" aria-labelledby="fl-${uid}">
                <button type="button" data-cmd="fan-on" aria-pressed="false">On</button><button type="button" data-cmd="fan-off" aria-pressed="false">Off</button>
              </div></div>
          </div>
        </div>
        <ol class="steps" data-f="steps" aria-label="Command progress" style="list-style:none;margin-bottom:0"></ol>
        <div class="step-timer" data-f="step-timer" hidden><i></i></div>
        <div class="step-msg" data-f="step-msg" role="status" aria-live="polite"></div>

        <form class="thresholds" data-f="settings">
          <div class="grid">
            <div><label for="t-${uid}">Temp threshold <span class="val" data-f="tv"></span></label>
              <input type="range" class="temp" id="t-${uid}" name="tempOn" min="15" max="40" step="0.5"></div>
            <div><label for="h-${uid}">Humidity threshold <span class="val" data-f="hv"></span></label>
              <input type="range" class="hum" id="h-${uid}" name="humOn" min="30" max="90" step="1"></div>
            <button type="submit" class="secondary">Save <span class="dirty" data-f="dirty" hidden>•</span></button>
          </div>
          <p class="field-hint" style="margin:8px 0 0">In Auto mode the fan turns on when either reading reaches its threshold, and off again once both have dropped slightly below it.</p>
        </form>

        <div class="chart-head">
          <h3>History</h3>
          <div class="seg" role="group" aria-label="History range" data-f="range">
            <button type="button" data-min="15">15m</button><button type="button" data-min="60">1h</button>
            <button type="button" data-min="360">6h</button><button type="button" data-min="1440">24h</button>
          </div>
        </div>
        <div class="chart-box" data-f="chart"></div>
        <div class="chart-legend" aria-hidden="true">
          <span><i class="lg-line" style="color:var(--series-temp)"></i>Temperature</span>
          <span><i class="lg-line" style="color:var(--series-hum)"></i>Humidity</span>
          <span><i class="lg-dash"></i>Threshold</span>
          <span><i class="lg-diamond"></i>Recovered reading</span>
          <span><i class="lg-band"></i>Outage window</span>
        </div>
        <div class="muted small" data-f="hist-summary" style="margin-top:6px"></div>
        <details>
          <summary>Recent history records</summary>
          <div class="table-scroll"><table>
            <thead><tr><th>Time</th><th>Temp</th><th>Hum</th><th>Mode</th><th>Fan</th><th>Source</th></tr></thead>
            <tbody data-f="hist-rows"></tbody>
          </table></div>
        </details>
        <div class="device-foot">
          <span class="muted small" data-f="updated"></span>
          <button type="button" class="danger" data-cmd="remove">Remove node</button>
        </div>
      </div>`;

    const card = { el, device, pending: null, settingsDirty: false, chart: null, lastHistory: 0, rangeMinutes, hist: [] };
    const q = (f) => el.querySelector(`[data-f="${f}"]`);
    card.q = q;
    card.fan = UI.fan(el.querySelector(".fan"));

    el.querySelectorAll("[data-cmd]").forEach((btn) => btn.addEventListener("click", () => onControl(card, btn.dataset.cmd)));
    q("copy").addEventListener("click", () => UI.copy(device.deviceId));

    const form = q("settings");
    const sync = () => {
      q("tv").textContent = `${num(form.tempOn.value)} °C`;
      q("hv").textContent = `${form.humOn.value} %`;
      UI.rangeFill(form.tempOn); UI.rangeFill(form.humOn);
      q("dirty").hidden = !card.settingsDirty;
    };
    form.addEventListener("input", () => { card.settingsDirty = true; sync(); });
    form.addEventListener("submit", (e) => { e.preventDefault(); onSaveSettings(card, form); });
    card.syncSliders = sync;

    q("range").addEventListener("click", (e) => {
      const b = e.target.closest("[data-min]");
      if (!b) return;
      rangeMinutes = Number(b.dataset.min);
      sessionStorageSet("sv.range", rangeMinutes);
      cards.forEach((c) => { markRange(c); loadHistory(c); });
    });
    markRange(card);

    card.chart = new SVChart(q("chart"), {
      label: `Temperature and humidity history for ${device.name}`,
      series: [
        { key: "temperature", label: "Temperature", unit: "°C", color: "--series-temp", decimals: 1 },
        { key: "humidity", label: "Humidity", unit: "%", color: "--series-hum", decimals: 0 },
      ],
    });
    return card;
  }

  function markRange(card) {
    card.q("range").querySelectorAll("[data-min]").forEach((b) => {
      const on = Number(b.dataset.min) === rangeMinutes;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  // ---------------------------------------------------------------- rendering

  function isOnline(l) { return l && Date.now() - tsOf(l) < ONLINE_WINDOW_MS; }

  function setRing(card, key, value, range, thr) {
    const { q } = card;
    q(`${key}-arc`).setAttribute("stroke-dasharray", `${value === undefined ? 0 : pct(value, range).toFixed(2)} 100`);
    q(`${key}-tick`).style.transform = `rotate(${(pct(thr, range) * 2.7).toFixed(2)}deg)`;
    q(`${key}-g`).classList.toggle("over", value !== undefined && value >= thr);
  }

  // Change over the last 10 minutes, from history + live readings.
  function setTrend(card, key, unit, steady, decimals) {
    const el = card.q(`${key === "temperature" ? "temp" : "hum"}-trend`);
    const pts = card.hist.filter((p) => p[key] !== undefined && p.ts >= Date.now() - TREND_WINDOW_MS);
    if (pts.length < 2) { el.className = "trend"; el.lastElementChild.textContent = "No trend yet"; return; }
    const d = pts[pts.length - 1][key] - pts[0][key];
    const dir = Math.abs(d) < steady ? "" : d > 0 ? "up" : "down";
    el.className = `trend ${dir}`;
    const mins = Math.max(1, Math.round((pts[pts.length - 1].ts - pts[0].ts) / 60000));
    el.lastElementChild.textContent = dir ? `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(decimals)} ${unit} in ${mins} min` : `Steady over ${mins} min`;
  }

  function setSpark(card, key, f) {
    const svg = card.q(`${f}-spark`);
    const w = Math.max(60, Math.round(svg.clientWidth || 140)), h = 34;
    const pts = card.hist.filter((p) => p[key] !== undefined && p.ts >= Date.now() - SPARK_WINDOW_MS);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    if (pts.length < 2) { svg.innerHTML = ""; return; }
    const stride = Math.ceil(pts.length / 90);
    const s = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
    const vals = s.map((p) => p[key]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 0.5) { lo -= 0.25; hi += 0.25; }
    const t0 = s[0].ts, t1 = s[s.length - 1].ts || t0 + 1;
    const X = (t) => 2 + ((t - t0) / (t1 - t0 || 1)) * (w - 6), Y = (v) => 3 + (1 - (v - lo) / (hi - lo)) * (h - 6);
    const d = s.map((p, i) => `${i ? "L" : "M"}${X(p.ts).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join("");
    const last = s[s.length - 1];
    svg.innerHTML = `<path class="ar" d="${d}L${X(t1).toFixed(1)} ${h}L${X(t0).toFixed(1)} ${h}Z"/><path class="ln" d="${d}"/>` +
      `<circle class="end" cx="${X(last.ts).toFixed(1)}" cy="${Y(last[key]).toFixed(1)}" r="3"/>`;
  }

  function updateCard(card, device) {
    const prevLatest = card.device?.latest;
    card.device = device;
    const { q } = card;
    const l = device.latest;
    q("name").textContent = device.name;
    q("name").title = device.name;
    paintRoom(card, device.name);

    const pill = q("pill");
    const notice = q("notice");
    const form = q("settings");
    const set = l?.settings || DEFAULTS;

    if (!l) {
      pill.className = "pill"; pill.lastElementChild.textContent = "No data";
      notice.textContent = "Waiting for the first reading. Make sure the node is powered and the gateway is online.";
      q("updated").textContent = "";
      q("seen").textContent = "";
    } else {
      const online = isOnline(l);
      pill.className = `pill ${online ? "online" : "offline"}`;
      pill.lastElementChild.textContent = online ? "Online" : "Offline";
      notice.textContent = online ? "" : `No data for ${UI.ago(tsOf(l)).replace(" ago", "")}. The values below are the last ones reported. Check that the node and gateway are powered.`;
      q("updated").textContent = `Updated ${UI.ago(tsOf(l))} · ${new Date(tsOf(l)).toLocaleTimeString()} · seq ${l.seq ?? "–"}`;
      q("seen").textContent = `Last seen ${UI.ago(tsOf(l))}`;

      // A new sequence number means a fresh reading: give the gauges a short pulse.
      if (card.lastSeq !== undefined && l.seq !== card.lastSeq) pulse(card, l, prevLatest);

      // Append fresh live readings so the chart, sparklines and trends move between history reloads.
      const lastTs = card.hist.length ? card.hist[card.hist.length - 1].ts : 0;
      if (tsOf(l) > lastTs && l.seq !== card.lastSeq && card.historyLoaded) {
        card.hist.push({ ts: tsOf(l), temperature: l.temperature, humidity: l.humidity, mode: l.mode, fanOn: l.fanOn, source: "live", backfill: false });
        card.chart.setData(card.hist);
      }
      card.lastSeq = l.seq;

      // Gauges: ring = reading, tick = threshold, outlined when at/over threshold.
      UI.countTo(q("temp"), l.temperature, 1);
      UI.countTo(q("hum"), l.humidity, 0);
      setRing(card, "temp", l.temperature, TEMP_RANGE, set.tempOn);
      setRing(card, "hum", l.humidity, HUM_RANGE, set.humOn);
      q("temp-thr").textContent = `Limit ${num(set.tempOn)} °C`;
      q("hum-thr").textContent = `Limit ${num(set.humOn, 0)} %`;
      setTrend(card, "temperature", "°C", 0.15, 1);
      setTrend(card, "humidity", "%", 0.8, 0);
      setSpark(card, "temperature", "temp");
      setSpark(card, "humidity", "hum");

      const manual = l.mode === "manual";
      card.fan.set(!!l.fanOn);
      q("fan-badge").classList.toggle("on", !!l.fanOn);
      q("fan-label").textContent = l.fanOn ? "Fan running" : "Fan off";
      q("mode-label").textContent = manual ? "Manual override" : "Automatic (sensor-based)";
      const btn = (c) => card.el.querySelector(`[data-cmd="${c}"]`);
      const press = (c, on) => { btn(c).classList.toggle("on", on); btn(c).setAttribute("aria-pressed", String(on)); };
      press("auto", !manual);
      press("manual", manual);
      press("fan-on", manual && !!l.fanOn);
      press("fan-off", manual && !l.fanOn);
    }

    // Keep sliders in sync with what the node reports, unless the user is editing.
    if (!card.settingsDirty && !form.contains(document.activeElement)) {
      form.tempOn.value = set.tempOn;
      form.humOn.value = set.humOn;
    }
    card.syncSliders();
    updateChartView(card, set);
    checkPending(card);
  }

  // Purely visual feedback for a fresh reading: the card's accent ring pings and
  // each value briefly tints toward the direction it moved.
  function pulse(card, l, prev) {
    const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
    restart(card.el, "fresh");
    [["temp", "temperature", 0.05], ["hum", "humidity", 0.5]].forEach(([f, key, eps]) => {
      const el = card.q(f);
      el.classList.remove("tick-up", "tick-down");
      if (!prev || prev[key] === undefined || l[key] === undefined) return;
      const d = l[key] - prev[key];
      if (Math.abs(d) >= eps) restart(el, d > 0 ? "tick-up" : "tick-down");
    });
  }

  function updateChartView(card, set) {
    const now = Date.now(), from = now - card.rangeMinutes * 60000;
    card.chart.setView(from, now, { temperature: Number(set.tempOn), humidity: Number(set.humOn) });
  }

  async function loadHistory(card) {
    card.lastHistory = Date.now();
    card.rangeMinutes = rangeMinutes;
    // Trends and sparklines need at least 30 minutes even when the chart shows 15.
    const minutes = Math.max(rangeMinutes, 30);
    try {
      const { items } = await Api.history(card.device.deviceId, minutes);
      card.hist = items.map((i) => ({ ...i, ts: Number(i.ts),
        temperature: i.temperature === undefined ? undefined : Number(i.temperature),
        humidity: i.humidity === undefined ? undefined : Number(i.humidity),
        backfill: i.source === "backfill" })).sort((a, b) => a.ts - b.ts);
      card.historyLoaded = true;
      card.chart.setData(card.hist);
      updateChartView(card, card.device.latest?.settings || DEFAULTS);

      const inRange = items.filter((i) => Number(i.ts) >= Date.now() - rangeMinutes * 60000);
      const recovered = inRange.filter((i) => i.source === "backfill").length;
      card.q("hist-summary").textContent = inRange.length
        ? `${inRange.length} readings` + (recovered ? ` · ${recovered} recovered after an outage (hollow diamonds on the hatched band)` : "")
        : "No readings in this time range yet.";
      card.q("hist-rows").innerHTML = inRange.slice(-20).reverse().map((i) => `
        <tr><td>${esc(new Date(Number(i.ts)).toLocaleTimeString())}</td>
        <td class="num">${num(i.temperature)}</td><td class="num">${num(i.humidity)}</td>
        <td>${esc(i.mode)}</td><td>${i.fanOn ? "on" : "off"}</td>
        <td><span class="badge ${i.source === "backfill" ? "backfill" : ""}">${esc(i.source || "live")}</span></td></tr>`).join("");
      if (card.device.latest) { setSpark(card, "temperature", "temp"); setSpark(card, "humidity", "hum");
        setTrend(card, "temperature", "°C", 0.15, 1); setTrend(card, "humidity", "%", 0.8, 0); }
    } catch (e) {
      card.q("hist-summary").textContent = `Could not load history: ${e.message}`;
    }
  }

  function updateStats(devices) {
    const online = devices.filter((d) => isOnline(d.latest));
    const fans = devices.filter((d) => isOnline(d.latest) && d.latest.fanOn).length;
    const temps = online.map((d) => d.latest.temperature).filter((t) => t !== undefined);
    UI.countTo($("st-nodes"), devices.length);
    UI.countTo($("st-online"), online.length);
    $("st-online-of").textContent = ` / ${devices.length}`;
    UI.countTo($("st-fans"), fans);
    UI.countTo($("st-temp"), temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null, 1);
    $("st-temp-u").textContent = temps.length ? " °C" : "";
  }

  // Header status pill. While the connection is healthy it shows a compact
  // "updated Ns ago" ticker; the exact time stays in the tooltip.
  let liveAt = 0;
  function setLive(ok, text) {
    const el = $("live");
    el.className = `live ${ok ? "ok" : "bad"}`;
    liveAt = ok ? Date.now() : 0;
    el.title = ok ? text : "";
    el.lastElementChild.textContent = ok ? "Live · updated just now" : text;
    if (ok) { const r = el.querySelector(".live-ring"); r.classList.remove("run"); void r.offsetWidth; r.classList.add("run"); }
  }
  setInterval(() => {
    if (!liveAt) return;
    const s = Math.round((Date.now() - liveAt) / 1000);
    $("live").lastElementChild.textContent = s < 1 ? "Live · updated just now" : `Live · updated ${s}s ago`;
  }, 1000);

  // ---------------------------------------------------------------- commands

  const STAGES = [["sent", "Sent"], ["delivered", "Delivered to node"], ["confirmed", "Confirmed by node"]];

  function renderSteps(card, p = card.pending) {
    const steps = card.q("steps");
    if (!p) return;
    const idx = Math.max(0, STAGES.findIndex(([s]) => s === p.stage));
    const classes = STAGES.map((_, i) => {
      if (p.stage === "failed") return i === 0 ? "done" : i === p.failedAt ? "fail" : "";
      if (i < idx || p.stage === "confirmed") return "done";
      if (i === idx) return "active";
      return "";
    });
    const state = { done: "done", fail: "failed", active: "in progress", "": "pending" };
    steps.innerHTML = STAGES.map(([, label], i) => {
      const cls = classes[i];
      const mark = cls === "done" ? UI.ICON.check : cls === "fail" ? UI.ICON.x : String(i + 1);
      const step = `<li class="step ${cls}"><span class="b" aria-hidden="true">${mark}</span><span>${label}<span class="sr-only">: ${state[cls]}</span></span></li>`;
      const next = classes[i + 1];
      const line = i < STAGES.length - 1 ? `<li class="step-line ${next === "done" ? "done" : next === "active" ? "active" : ""}" aria-hidden="true"></li>` : "";
      return step + line;
    }).join("");
  }

  function setTimer(card, ms) {
    const t = card.q("step-timer");
    if (!ms) { t.hidden = true; return; }
    t.hidden = false;
    const bar = t.firstElementChild;
    bar.style.animation = "none";
    void bar.offsetWidth; // restart the CSS animation
    bar.style.animation = "";
    bar.style.animationDuration = `${ms}ms`;
  }

  function setBusy(card, busy) {
    card.el.querySelectorAll("[data-cmd], .thresholds button").forEach((b) => {
      if (b.dataset.cmd !== "remove") b.disabled = busy;
    });
  }

  // Send a command and remember what reported state would confirm it.
  async function send(card, label, apiCall, expect) {
    const msg = card.q("step-msg");
    const seqAtSend = card.device.latest?.seq;
    setBusy(card, true);
    card.pending = { label, cmdId: null, expect, seqAtSend, deadline: Date.now() + CONFIRM_TIMEOUT_MS, stage: "sent" };
    renderSteps(card);
    setTimer(card, CONFIRM_TIMEOUT_MS);
    msg.className = "step-msg"; msg.textContent = `Sending "${label}"…`;
    try {
      const res = await apiCall();
      card.pending.cmdId = res.cmdId;
      msg.textContent = `"${label}" sent. Waiting for the node to report the new state…`;
    } catch (e) {
      card.pending = null;
      card.q("steps").innerHTML = "";
      setTimer(card, 0);
      msg.className = "step-msg fail"; msg.textContent = `Could not send "${label}": ${e.message}`;
      UI.toast(`Could not send "${label}": ${e.message}`, "error");
      setBusy(card, false);
    }
  }

  function finishPending(card, ok, text) {
    const p = card.pending;
    card.pending = null;
    p.stage = ok ? "confirmed" : "failed";
    renderSteps(card, p);
    setTimer(card, 0);
    const msg = card.q("step-msg");
    msg.className = `step-msg ${ok ? "ok" : "fail"}`; msg.textContent = text;
    UI.toast(text, ok ? "ok" : "error");
    setBusy(card, false);
    if (ok) setTimeout(() => { if (!card.pending) { card.q("steps").innerHTML = ""; msg.textContent = ""; } }, 6000);
  }

  function checkPending(card) {
    const p = card.pending;
    if (!p) return;
    const l = card.device.latest;
    // Require a NEW telemetry packet (different seq) that shows the requested state.
    if (l && l.seq !== p.seqAtSend && p.expect(l)) {
      finishPending(card, true, `Confirmed: the node reports "${p.label}".`);
    } else if (["node_offline", "ble_write_failed", "rejected"].includes(p.ack)) {
      const why = { node_offline: "the node is not connected to the gateway",
        ble_write_failed: "the gateway could not write to the node over BLE",
        rejected: "the gateway rejected the command" }[p.ack];
      p.failedAt = 1;
      finishPending(card, false, `"${p.label}" failed: ${why}.`);
    } else if (Date.now() > p.deadline) {
      p.failedAt = p.stage === "delivered" ? 2 : 1;
      finishPending(card, false, `No confirmation from the node within ${CONFIRM_TIMEOUT_MS / 1000}s. The values shown are what the node last reported.`);
    } else {
      renderSteps(card);
    }
  }

  async function pollAck(card) {
    const p = card.pending;
    if (!p || !p.cmdId) return;
    try {
      const { status } = await Api.commandStatus(card.device.deviceId, p.cmdId);
      if (card.pending === p) {
        p.ack = status;
        if (status === "delivered") {
          p.stage = "delivered";
          card.q("step-msg").textContent = `"${p.label}" delivered to the node. Waiting for its reported state…`;
        }
        checkPending(card);
      }
    } catch { /* status is best-effort; the timeout still applies */ }
  }

  async function onControl(card, cmd) {
    const id = card.device.deviceId;
    switch (cmd) {
      case "auto":
        return send(card, "Auto mode", () => Api.sendCommand(id, { action: "auto" }), (l) => l.mode === "auto");
      case "manual":
        return send(card, "Manual mode", () => Api.sendCommand(id, { action: "manual" }), (l) => l.mode === "manual");
      case "fan-on":
        return send(card, "Fan on (manual)", () => Api.sendCommand(id, { action: "fan", fanOn: true }), (l) => l.mode === "manual" && l.fanOn === true);
      case "fan-off":
        return send(card, "Fan off (manual)", () => Api.sendCommand(id, { action: "fan", fanOn: false }), (l) => l.mode === "manual" && l.fanOn === false);
      case "remove": {
        const yes = await UI.confirm({ title: `Remove ${card.device.name}?`, danger: true, confirmLabel: "Remove",
          message: `${id} will be removed from your account. Its stored history is not deleted.` });
        if (!yes) return;
        try { await Api.removeDevice(id); UI.toast(`${card.device.name} removed`, "ok"); refresh(); }
        catch (e) { UI.toast(e.message, "error"); }
      }
    }
  }

  function onSaveSettings(card, form) {
    const l = card.device.latest?.settings || DEFAULTS;
    const s = { tempOn: Number(form.tempOn.value), humOn: Number(form.humOn.value), aqOn: Number(l.aqOn ?? DEFAULTS.aqOn) };
    const close = (a, b, tol) => Math.abs(Number(a) - b) <= tol;
    card.settingsDirty = false;
    card.syncSliders();
    send(card, "Update thresholds", () => Api.updateSettings(card.device.deviceId, s),
      (r) => r.settings && close(r.settings.tempOn, s.tempOn, 0.011) && close(r.settings.humOn, s.humOn, 0.011));
  }

  // ---------------------------------------------------------------- polling

  async function refresh() {
    let devices;
    try {
      ({ devices } = await Api.listDevices());
      $("global-msg").className = "alert"; $("global-msg").textContent = "";
      setLive(true, `Live · updated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setLive(false, "Connection lost, retrying…");
      $("global-msg").className = "alert error";
      $("global-msg").textContent = `Could not retrieve device data: ${e.message}. Showing the last data received.`;
      cards.forEach(checkPending);
      if (firstLoad) { container.innerHTML = ""; container.removeAttribute("aria-busy"); firstLoad = false; }
      return;
    }
    if (firstLoad) { container.innerHTML = ""; container.removeAttribute("aria-busy"); firstLoad = false; }

    const seen = new Set();
    devices.forEach((d, i) => {
      seen.add(d.deviceId);
      let card = cards.get(d.deviceId);
      if (!card) {
        card = createCard(d, i);
        cards.set(d.deviceId, card);
        container.appendChild(card.el);
        loadHistory(card);
      }
      updateCard(card, d);
      pollAck(card);
      if (Date.now() - card.lastHistory > 30000) loadHistory(card);
    });
    for (const [id, card] of cards) {
      if (!seen.has(id)) { card.chart.destroy(); card.el.remove(); cards.delete(id); }
    }
    $("empty").hidden = devices.length > 0;
    updateStats(devices);
  }

  // ---------------------------------------------------------------- add node

  const dlg = $("add-dialog");
  const openAdd = () => { $("add-msg").className = "alert"; $("add-msg").textContent = ""; dlg.showModal(); $("add-id").focus(); };
  $("open-add").addEventListener("click", openAdd);
  $("empty-add").addEventListener("click", openAdd);
  if (new URLSearchParams(location.search).has("demo")) $("empty-demo").hidden = true;
  $("add-cancel").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("add-msg");
    const btn = e.submitter;
    btn?.classList.add("loading");
    try {
      const d = await Api.addDevice($("add-id").value.trim().toLowerCase(), $("add-name").value.trim());
      UI.toast(`Added ${d.name}`, "ok");
      $("add-id").value = ""; $("add-name").value = "";
      dlg.close();
      refresh();
    } catch (err) {
      msg.className = "alert error"; msg.textContent = err.message;
    } finally {
      btn?.classList.remove("loading");
    }
  });

  refresh();
  setInterval(refresh, POLL_MS);
})();
