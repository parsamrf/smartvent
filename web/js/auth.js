// Account management against Amazon Cognito User Pools.
// Calls the Cognito JSON API directly over HTTPS (no SDK needed).
const Auth = (() => {
  const cfg = window.SMARTVENT_CONFIG;
  const STORE_KEY = "smartvent.session";

  async function cognito(target, body) {
    const res = await fetch(`https://cognito-idp.${cfg.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Authentication error (${res.status})`);
    return data;
  }

  function decodeJwt(token) {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; }
  }
  function save(session) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(session)); } catch { /* private mode */ }
  }
  function clear() {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }

  function storeResult(result, email, refreshToken) {
    const claims = decodeJwt(result.IdToken);
    save({
      idToken: result.IdToken,
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken || refreshToken,
      expiresAt: claims.exp * 1000,
      email: claims.email || email,
    });
  }

  async function register(email, password) {
    await cognito("SignUp", {
      ClientId: cfg.clientId,
      Username: email,
      Password: password,
      UserAttributes: [{ Name: "email", Value: email }],
    });
  }

  async function login(email, password) {
    const data = await cognito("InitiateAuth", {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: cfg.clientId,
      AuthParameters: { USERNAME: email, PASSWORD: password },
    });
    storeResult(data.AuthenticationResult, email);
  }

  async function logout() {
    const s = load();
    clear();
    if (s?.accessToken) {
      // Revoke tokens server-side too; local logout already happened.
      await cognito("GlobalSignOut", { AccessToken: s.accessToken }).catch(() => {});
    }
  }

  // Returns a valid ID token, refreshing it if it expires within a minute.
  async function getIdToken() {
    const s = load();
    if (!s) return null;
    if (Date.now() < s.expiresAt - 60_000) return s.idToken;
    try {
      const data = await cognito("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: cfg.clientId,
        AuthParameters: { REFRESH_TOKEN: s.refreshToken },
      });
      storeResult(data.AuthenticationResult, s.email, s.refreshToken);
      return load().idToken;
    } catch {
      clear();
      return null;
    }
  }

  return {
    register, login, logout, getIdToken,
    isLoggedIn: () => !!load(),
    email: () => load()?.email || "",
  };
})();
