import { kv } from "@vercel/kv";

const KEY = "procore:refresh_token";
const LOCK = "procore:refresh_lock";

export async function getRefreshToken() {
  return await kv.get(KEY);
}

export async function setRefreshToken(token) {
  if (token) await kv.set(KEY, token);
}

export async function withRefreshLock(fn) {
  const lockVal = `${Date.now()}-${Math.random()}`;

  const acquired = await kv.set(LOCK, lockVal, { nx: true, ex: 10 });

  if (!acquired) {
    await new Promise((r) => setTimeout(r, 500));
    return fn();
  }

  try {
    return await fn();
  } finally {
    const current = await kv.get(LOCK);
    if (current === lockVal) await kv.del(LOCK);
  }
}
