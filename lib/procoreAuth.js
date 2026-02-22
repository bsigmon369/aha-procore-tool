export async function procoreFetch(path, options = {}) {
  const token = await getAccessToken();

  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  const companyId = process.env.PROCORE_COMPANY_ID;

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
    ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
  };

  const resp = await fetch(url, { ...options, headers });

  if (!resp.ok) {
    let errBody = null;
    try { errBody = await resp.json(); } catch {}
    throw new Error(`Procore API error ${resp.status} on ${url}: ${JSON.stringify(errBody)}`);
  }

  return resp;
}
