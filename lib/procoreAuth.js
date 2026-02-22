import { getRefreshToken, setRefreshToken, withRefreshLock } from "./refreshStore";

const OAUTH_BASE_URL = process.env.PROCORE_BASE_URL || "https://app.procore.com";
const API_BASE_URL = process.env.PROCORE_API_BASE_URL || "https://api.procore.com";

// IMPORTANT: never a single global token; cache per company+user only.
const memCache = new Map(); // key -> { accessToken, expiresAt }

function cacheKey(companyId, userId) {
  return `${companyId || ""}:${userId || ""}`;
}

export async function getAccessToken(companyId, userId) {
  if (!companyId) throw new Error("companyId is required to mint an access token");

  const key = cacheKey(companyId, userId);
  const now = Date.now();
  const cached = memCache.get(key);

  if (cached?.accessToken && now < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  return withRefreshLock(companyId, userId, async () => {
    const now2 = Date.now();
    const cached2 = memCache.get(key);
    if (cached2?.accessToken && now2 < cached2.expiresAt - 60_000) {
      return cached2.accessToken;
    }

    let refreshToken = await getRefreshToken(companyId, userId);
    if (!refreshToken) refreshToken = process.env.PROCORE_REFRESH_TOKEN; // dev escape hatch
    if (!refreshToken) throw new Error("No Procore refresh token found");

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
      cache: "no-store",
    });

    const data = await r.json();
    if (!r.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

    memCache.set(key, {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    if (data.refresh_token && data.refresh_token !== refreshToken) {
      await setRefreshToken(companyId, userId, data.refresh_token);
    }

    return data.access_token;
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

  const resp = await fetch(url, { ...options, headers, cache: "no-store" });

  if (!resp.ok) {
    let errBody = null;
    try {
      errBody = await resp.json();
    } catch {}
    throw new Error(`Procore API error ${resp.status} on ${url}: ${JSON.stringify(errBody)}`);
  }

  return resp;
}

export async function procoreFetchSafe(path, options = {}, companyId, userId) {
  try {
    const token = await getAccessToken(companyId, userId);
    const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;

    const headers = {
      Authorization: `Bearer ${token}`,
      ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
      ...(options.headers || {}),
    };

    const resp = await fetch(url, { ...options, headers, cache: "no-store" });

    let data = null;
    try {
      data = await resp.json();
    } catch {}

    return { ok: resp.ok, status: resp.status, url, data };
  } catch (err) {
    return { ok: false, status: 0, url: path, data: { error: err?.message || "Unknown error" } };
  }
}
