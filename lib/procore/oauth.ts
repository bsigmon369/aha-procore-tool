export async function refreshAccessToken(refreshToken: string) {
  const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.PROCORE_CLIENT_ID!,
    client_secret: process.env.PROCORE_CLIENT_SECRET!,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Refresh failed: ${JSON.stringify(data)}`);

  return data as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type?: string;
  };
}
