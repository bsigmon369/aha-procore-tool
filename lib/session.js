import crypto from "crypto";

const COOKIE_NAME = "aha_procore_session";

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlToBuf(s) {
  const pad = 4 - (s.length % 4 || 4);
  const base64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function sign(input, secret) {
  return b64url(crypto.createHmac("sha256", secret).update(input).digest());
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}

export function createSessionValue(payload, { ttlSeconds = 60 * 60 * 12 } = {}) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET");

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data = { ...payload, exp };
  const json = JSON.stringify(data);
  const body = b64url(json);
  const sig = sign(body, secret);
  return `${body}.${sig}`;
}

export function readSessionValue(raw) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (!raw || typeof raw !== "string") return null;

  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;

  const expected = sign(body, secret);
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const json = b64urlToBuf(body).toString("utf8");
    const data = JSON.parse(json);
    if (data?.exp && Math.floor(Date.now() / 1000) > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}
