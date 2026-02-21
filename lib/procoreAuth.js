import { getRefreshToken, setRefreshToken, withRefreshLock } from "./refreshStore";

const OAUTH_BASE_URL = process.env.PROCORE_BASE_URL || "https://app.procore.com";
const API_BASE_URL = process.env.PROCORE_API_BASE_URL || "https://api.procore.com";

let cached = {
  accessToken: null,
  expiresAt: 0,
};

export async function getAccessToken() {
  const now = Date.now();

  if (cached.accessToken && now < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  return withRefreshLock(async () => {
    const now2 = Date.now();

    if (cached.accessToken && now2 < cached.expiresAt - 60_000) {
      return cached.accessToken;
    }

    let refreshToken = await getRefreshToken();

    if (!refreshToken) {
      refreshToken = process.env.PROCORE_REFRESH_TOKEN;
    }

    if (!refreshToken) {
      throw new Error("No Procore refresh token found (KV or env)");
    }

    const tokenUrl = `${OAUTH_BASE_URL}/oauth/token`;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.PROCORE_CLIENT_ID,
      client_secret: process.env.PROCORE_CLIENT_SECRET,
    });

    const r = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const data = await r.json();

    if (!r.ok) {
      throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    }

    cached.accessToken = data.access_token;
    cached.expiresAt = Date.now() + data.expires_in * 1000;

    // Handle refresh token rotation
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      await setRefreshToken(data.refresh_token);
    }

    return cached.accessToken;
  });
}

export async function procoreFetch(path, options = {}) {
  const token = await getAccessToken();

  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path}`;

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const resp = await fetch(url, { ...options, headers });

  if (!resp.ok) {
    let errBody = null;
    try { errBody = await resp.json(); } catch {}
    throw new Error(
      `Procore API error ${resp.status} on ${url}: ${JSON.stringify(errBody)}`
    );
  }

  return resp;
}
