// Thin client for the SmartVent HTTP API. Every call sends the Cognito ID
// token; API Gateway's JWT authorizer rejects requests without a valid one.
const Api = (() => {
  const base = window.SMARTVENT_CONFIG.apiUrl.replace(/\/$/, "");

  async function request(method, path, body) {
    const token = await Auth.getIdToken();
    if (!token) {
      location.href = "login.html?expired=1";
      throw new Error("Session expired - please log in again");
    }
    let res;
    try {
      res = await fetch(base + path, {
        method,
        headers: { Authorization: token, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Network error: could not reach the SmartVent server");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.href = "login.html?expired=1";
    }
    if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
    return data;
  }

  const enc = encodeURIComponent;
  return {
    listDevices: () => request("GET", "/devices"),
    addDevice: (deviceId, name) => request("POST", "/devices", { deviceId, name }),
    removeDevice: (id) => request("DELETE", `/devices/${enc(id)}`),
    history: (id, minutes = 60) => request("GET", `/devices/${enc(id)}/history?minutes=${minutes}`),
    sendCommand: (id, cmd) => request("POST", `/devices/${enc(id)}/commands`, cmd),
    updateSettings: (id, s) => request("PUT", `/devices/${enc(id)}/settings`, s),
    commandStatus: (id, cmdId) => request("GET", `/devices/${enc(id)}/commands/${enc(cmdId)}`),
    ask: (question) => request("POST", "/assistant", { question }),
  };
})();
