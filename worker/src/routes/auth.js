/**
 * Auth Routes — Proxy to Auth Service with KV role overrides
 */

import { requireAuth } from '../auth/middleware.js';
import { kvGet, kvPut } from '../kv/store.js';

export async function getEffectiveRole(kv, userId) {
  const superadmin = await kvGet(kv, 'config::superadmin');
  if (String(superadmin) === String(userId)) return 'superadmin';

  const roleOverride = await kvGet(kv, `user-role::${userId}`);
  if (roleOverride) return roleOverride.role;

  return null;
}

export async function handleAuth(path, method, request, env) {
  if (path === '/api/auth/request-code' && method === 'POST') {
    if (!env.AUTH_SERVICE) return err(503, 'Auth service not configured');
    try {
      const body = await request.text();
      const res = await env.AUTH_SERVICE.fetch(new Request('https://auth/request-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }));
      return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
      return err(502, `Auth service error: ${e.message}`);
    }
  }

  if (path === '/api/auth/verify-code' && method === 'POST') {
    if (!env.AUTH_SERVICE) return err(503, 'Auth service not configured');
    try {
      const body = await request.text();
      const res = await env.AUTH_SERVICE.fetch(new Request('https://auth/verify-code', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }));
      if (!res.ok) return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'application/json' } });

      const data = await res.json();
      if (data.user?.id) {
        const existingSuperadmin = await kvGet(env.KV, 'config::superadmin');
        if (!existingSuperadmin) await kvPut(env.KV, 'config::superadmin', data.user.id);
        const kvRole = await getEffectiveRole(env.KV, data.user.id);
        if (kvRole) data.user.role = kvRole;
      }
      return ok(data);
    } catch (e) {
      return err(502, `Auth service error: ${e.message}`);
    }
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const { auth, error } = await requireAuth(request, env);
    if (error) return error;
    const kvRole = await getEffectiveRole(env.KV, auth.user.userId);
    const user = { ...auth.user };
    if (kvRole) user.role = kvRole;
    return ok({ user });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    return ok({ success: true });
  }

  return null;
}

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function err(status, message) {
  return ok({ error: message }, status);
}
