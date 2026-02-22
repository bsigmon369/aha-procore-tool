import { kv } from "@vercel/kv";

function rtUserKey(companyId, userId) {
  return `procore:rt:${companyId}:${userId}`;
}

// "Last known good" token for a company (dev / break-glass).
function rtCompanyKey(companyId) {
  return `procore:rt:${companyId}`;
}

function lockKey(companyId, userId) {
  const who = userId ? String(userId) : "company";
  return `procore:lock:${companyId}:${who}`;
}

export async function getRefreshToken(companyId, userId) {
  if (!companyId) return null;

  if (userId) {
    const userToken = await kv.get(rtUserKey(companyId, userId));
    if (userToken) return userToken;
  }

  return await kv.get(rtCompanyKey(companyId));
}

export async function setRefreshToken(companyId, userId, token) {
  if (!companyId || !token) return;

  if (userId) {
    await kv.set(rtUserKey(companyId, userId), token);
  }

  // keep company-level "last" token too
  await kv.set(rtCompanyKey(companyId), token);
}

// Lock per company+user (or per company when userId is unknown)
export async function withRefreshLock(companyId, userId, fn) {
  if (!companyId) return fn();

  const lock = lockKey(companyId, userId);
  const lockVal = `${Date.now()}-${Math.random()}`;

  const acquired = await kv.set(lock, lockVal, { nx: true, ex: 10 });

  if (!acquired) {
    await new Promise((r) => setTimeout(r, 350));
    return fn();
  }

  try {
    return await fn();
  } finally {
    const current = await kv.get(lock);
    if (current === lockVal) await kv.del(lock);
  }
}
