const OAUTH_BASE_URL = process.env.PROCORE_BASE_URL || "https://app.procore.com";
const API_BASE_URL = process.env.PROCORE_API_BASE_URL || "https://api.procore.com";

// Simple in-memory cache (works fine for MVP, but may refresh more often on serverless)
let cached = {
  accessToken: null,
  expiresAt: 0,
};

export async function getAccessToken() {
  const now = Date.now();

  // Reuse token if still valid (60s safety buffer)
  if (cached.accessToken && now < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const refreshToken = process.env.PROCORE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error("Missing PROCORE_REFRESH_TOKEN");
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
  cached.expiresAt = now + (data.expires_in * 1000);

  return cached.accessToken;
}

export async function procoreFetch(path, options = {}) {
  const token = await getAccessToken();

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };

  const resp = await fetch(url, { ...options, headers });

  // Helpful error surfacing for debugging
  if (!resp.ok) {
    let errBody = null;
    try { errBody = await resp.json(); } catch {}
    throw new Error(
      `Procore API error ${resp.status} on ${url}: ${JSON.stringify(errBody)}`
    );
  }

  return resp;
}
