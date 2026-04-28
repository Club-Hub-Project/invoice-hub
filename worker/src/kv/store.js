/**
 * KV Store Helpers — JSON serialization + index management
 */

export async function kvGet(kv, key) {
  const raw = await kv.get(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

export async function kvPut(kv, key, value, options = {}) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await kv.put(key, serialized, options);
}

export async function kvDelete(kv, key) {
  await kv.delete(key);
}

export async function kvGetList(kv, key) {
  const result = await kvGet(kv, key);
  return Array.isArray(result) ? result : [];
}

export async function kvIndexAdd(kv, indexKey, itemId) {
  const list = await kvGetList(kv, indexKey);
  if (!list.includes(itemId)) {
    list.push(itemId);
    await kvPut(kv, indexKey, list);
  }
}

export async function kvIndexRemove(kv, indexKey, itemId) {
  const list = await kvGetList(kv, indexKey);
  const filtered = list.filter(id => id !== itemId);
  await kvPut(kv, indexKey, filtered);
}

export async function kvGetMany(kv, prefix, ids) {
  const results = await Promise.all(ids.map(id => kvGet(kv, `${prefix}${id}`)));
  return results.filter(item => item !== null);
}

export function generateId() {
  return crypto.randomUUID();
}
