import { kv } from "@vercel/kv";

function rtKey(companyId, userId) {
  return `procore:rt:${companyId}:${userId}`;
}

function lockKey(companyId, userId) {
  return `procore:lock:${companyId}:${userId}`;
}

// New: per-company + per-user refresh token
export async function getRefreshToken(companyId, userId) {
  if (!companyId) return null;

  // Prefer per-user token if userId is present
  if (userId) {
    const userKey = `procore:rt:${companyId}:${userId}`;
    const userToken = await kv.get(userKey);
    if (userToken) return userToken;
  }

  // Fallback: company-scoped token (enables embedded mode without user_id in URL)
  const companyKey = `procore:rt:${companyId}`;
  return await kv.get(companyKey);
}

export async function setRefreshToken(companyId, userId, token) {
  if (!companyId || !userId || !token) return;
  await kv.set(rtKey(companyId, userId), token);
}

// Lock per user to avoid parallel refresh collisions
export async function withRefreshLock(companyId, userId, fn) {
  if (!companyId || !userId) return fn();

  const lock = lockKey(companyId, userId);
  const lockVal = `${Date.now()}-${Math.random()}`;

  const acquired = await kv.set(lock, lockVal, { nx: true, ex: 10 });

  if (!acquired) {
    await new Promise((r) => setTimeout(r, 500));
    return fn();
  }

  try {
    return await fn();
  } finally {
    const current = await kv.get(lock);
    if (current === lockVal) await kv.del(lock);
  }
}
