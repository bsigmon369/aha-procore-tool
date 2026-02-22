import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing code" }, { status: 400 });
  }
  if (!state) {
    return NextResponse.json({ ok: false, error: "Missing state" }, { status: 400 });
  }

  // state is base64url JSON: { nonce: "..." }
  let nonce = "";
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
    nonce = String(decoded?.nonce || "");
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }

  if (!nonce) {
    return NextResponse.json({ ok: false, error: "Missing nonce in state" }, { status: 400 });
  }

  // Pull companyId + returnTo from KV (set during /api/oauth/start)
  const stateKey = `oauth:state:${nonce}`;
  const st = (await kv.get(stateKey)) as any;

  const companyId = st?.companyId ? String(st.companyId) : "";
  const returnTo = st?.returnTo ? String(st.returnTo) : "/app";

  if (!companyId) {
    return NextResponse.json(
      { ok: false, error: "Missing companyId (state lookup failed)", nonce, stateKey, st },
      { status: 400 }
    );
  }

  // Exchange code -> token
  const tokenUrl = `${process.env.PROCORE_BASE_URL}/oauth/token`;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.PROCORE_CLIENT_ID!,
    client_secret: process.env.PROCORE_CLIENT_SECRET!,
    redirect_uri: process.env.PROCORE_REDIRECT_URI!,
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  const tokenData = await tokenRes.json().catch(() => null);

  if (!tokenRes.ok || !tokenData?.access_token) {
    return NextResponse.json(
      { ok: false, error: "Token exchange failed", status: tokenRes.status, data: tokenData },
      { status: 500 }
    );
  }

  // Fetch /me to get userId
  const meRes = await fetch(`${process.env.PROCORE_BASE_URL}/rest/v1.0/me`, {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Procore-Company-Id": companyId,
    },
    cache: "no-store",
  });

  const me = await meRes.json().catch(() => null);

  if (!meRes.ok || !me?.id) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch /me", status: meRes.status, data: me },
      { status: 500 }
    );
  }

  // Store refresh token (if present)
  if (tokenData.refresh_token) {
    await kv.set(`procore:rt:${companyId}:${me.id}`, tokenData.refresh_token);
    await kv.set(`procore:rt:${companyId}`, tokenData.refresh_token);
  }

  // Store a short-lived claim payload for the iframe to claim and set cookies in iframe context
  await kv.set(
    `oauth:claim:${nonce}`,
    { companyId: String(companyId), userId: String(me.id), returnTo },
    { ex: 300 }
  );

  // Clean up state record (optional but recommended)
  await kv.del(stateKey);

  // Return a tiny HTML page that notifies opener + closes popup
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>AHA Builder</title></head>
  <body style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 18px;">
    <div>Connected. You can close this window.</div>
    <script>
      (function(){
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: "AHA_OAUTH_DONE", nonce: ${JSON.stringify(nonce)} }, window.location.origin);
          }
        } catch (e) {}
        try { window.close(); } catch (e) {}
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
