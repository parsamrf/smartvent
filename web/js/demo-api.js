// Demo mode (dashboard.html?demo): replaces the real API with two simulated
// nodes so the UI can be shown or tested without hardware or an account.
// It is only loaded when "demo" is in the URL; normal use never touches it.
(() => {
  const nodes = {
    "vent-9e5d0536": { name: "Bedroom", temp: 22.6, hum: 47, mode: "auto", fan: false, set: { tempOn: 26, humOn: 58, aqOn: 1500 }, seq: 2200, hist: [] },
    "vent-6d5dccef": { name: "Kitchen", temp: 26.2, hum: 54, mode: "auto", fan: false, set: { tempOn: 27, humOn: 60, aqOn: 1500 }, seq: 4000, hist: [] },
  };
  const cmds = {};
  const rnd = (a) => (Math.random() - 0.5) * a;

  // One telemetry step: drift the readings, then apply the auto rule with hysteresis.
  function step(n, ts) {
    n.temp += rnd(0.5) + (n.fan ? -0.18 : 0.07);
    n.hum += rnd(1.2) + (n.fan ? -0.5 : 0.2);
    n.temp = Math.max(18, Math.min(35, n.temp));
    n.hum = Math.max(30, Math.min(85, n.hum));
    if (n.mode === "auto") {
      const over = n.temp >= n.set.tempOn || n.hum >= n.set.humOn;
      const clear = n.temp < n.set.tempOn - 0.5 && n.hum < n.set.humOn - 3;
      if (over) n.fan = true; else if (clear) n.fan = false;
    }
    n.seq++;
    n.ts = ts;
    n.hist.push({ ts, temperature: +n.temp.toFixed(2), humidity: +n.hum.toFixed(2), mode: n.mode, fanOn: n.fan,
      source: "live" });
    if (n.hist.length > 3000) n.hist.shift();
  }

  // Pre-fill 90 minutes of history; readings in a 5-minute window are marked as
  // recovered after an outage so the orange "backfill" points can be seen.
  const start = Date.now() - 90 * 60000;
  for (const n of Object.values(nodes)) {
    for (let t = start; t < Date.now(); t += 30000) {
      step(n, t);
      if (t > Date.now() - 32 * 60000 && t < Date.now() - 27 * 60000) n.hist[n.hist.length - 1].source = "backfill";
    }
  }
  // One fresh reading now so the nodes start out online.
  Object.values(nodes).forEach((n) => step(n, Date.now()));
  setInterval(() => Object.values(nodes).forEach((n) => step(n, Date.now())), 5000);

  const latest = (n) => ({
    ts: n.ts, receivedAt: n.ts, source: "live", mode: n.mode, fanOn: n.fan, seq: n.seq,
    temperature: +n.temp.toFixed(2), humidity: +n.hum.toFixed(2), settings: { ...n.set },
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Apply a command after a short delay, like the BLE round trip does.
  function apply(id, cmd) {
    const n = nodes[id];
    const cmdId = Math.random().toString(16).slice(2);
    cmds[cmdId] = { at: Date.now(), status: "sent" };
    setTimeout(() => { cmds[cmdId].status = "delivered"; }, 700);
    setTimeout(() => {
      if (cmd.action === "auto") n.mode = "auto";
      if (cmd.action === "manual") n.mode = "manual";
      if (cmd.action === "fan") { n.mode = "manual"; n.fan = cmd.fanOn; }
      if (cmd.action === "thresholds") n.set = { tempOn: cmd.tempOn, humOn: cmd.humOn, aqOn: cmd.aqOn };
      step(n, Date.now()); // the node sends fresh telemetry right after a command
    }, 1800);
    return { cmdId, status: "sent" };
  }

  Object.assign(Api, {
    async listDevices() { await wait(120); return { devices: Object.entries(nodes).map(([deviceId, n]) => ({ deviceId, name: n.name, latest: latest(n) })) }; },
    async addDevice(deviceId, name) {
      nodes[deviceId] = { name: name || deviceId, temp: 24, hum: 50, mode: "auto", fan: false, set: { tempOn: 27, humOn: 60, aqOn: 1500 }, seq: 1, hist: [] };
      step(nodes[deviceId], Date.now());
      return { deviceId, name: nodes[deviceId].name };
    },
    async removeDevice(id) { delete nodes[id]; return { deleted: id }; },
    async history(id, minutes) { await wait(80); const since = Date.now() - minutes * 60000; return { items: nodes[id].hist.filter((h) => h.ts >= since) }; },
    async sendCommand(id, cmd) { await wait(150); return apply(id, cmd); },
    async updateSettings(id, s) { await wait(150); return apply(id, { action: "thresholds", ...s }); },
    async commandStatus(id, cmdId) { return { cmdId, status: cmds[cmdId]?.status || "sent" }; },
    async ask() { return { answer: "Demo mode: the assistant is not available here.", snapshot: {} }; },
  });
})();
