import { getRefreshToken, setRefreshToken, withRefreshLock } from "./refreshStore";

const OAUTH_BASE_URL = process.env.PROCORE_BASE_URL || "https://app.procore.com";
const API_BASE_URL = process.env.PROCORE_API_BASE_URL || "https://api.procore.com";

let cached = {
  accessToken: null,
  expiresAt: 0,
};

export async function getAccessToken(companyId, userId) {
  const now = Date.now();

  if (cached.accessToken && now < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  // IMPORTANT: lock is now per company+user
  return withRefreshLock(companyId, userId, async () => {
    const now2 = Date.now();

    if (cached.accessToken && now2 < cached.expiresAt - 60_000) {
      return cached.accessToken;
    }

    // Pull refresh token for this specific embedded user
    let refreshToken = await getRefreshToken(companyId, userId);

    // (optional) fallback to env for a service account / dev mode
    if (!refreshToken) {
      refreshToken = process.env.PROCORE_REFRESH_TOKEN;
    }

    if (!refreshToken) {
      throw new Error("No Procore refresh token found for this user");
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

    // Save rotated refresh token (per user)
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      await setRefreshToken(companyId, userId, data.refresh_token);
    }

    return cached.accessToken;
  });
}
export async function procoreFetch(path, options = {}, companyId, userId) {
  const token = await getAccessToken(companyId, userId);
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
    ...(options.headers || {}),
  };

  const resp = await fetch(url, { ...options, headers });

  if (!resp.ok) {
    let errBody = null;
    try { errBody = await resp.json(); } catch {}
    throw new Error(`Procore API error ${resp.status} on ${url}: ${JSON.stringify(errBody)}`);
  }
  return resp;
}
export async function procoreFetchSafe(path, options = {}, companyId, userId) {
  const token = await getAccessToken(companyId, userId);

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

  const headers = {
    Authorization: `Bearer ${token}`,
    ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
    ...(options.headers || {}),
  };

  const resp = await fetch(url, { ...options, headers });

  let data = null;
  try {
    data = await resp.json();
  } catch {
    // ignore non-json bodies
  }

  return { ok: resp.ok, status: resp.status, url, data };
}
