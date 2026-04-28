/**
 * Invoice Hub — Cloudflare Worker Entry Point
 */

import { requireAuth } from './auth/middleware.js';
import { kvGetList, kvGet } from './kv/store.js';
import { handleAuth, getEffectiveRole } from './routes/auth.js';
import { handleSettings } from './routes/settings.js';
import { handleEvents } from './routes/events.js';
import { handleUpload } from './routes/upload.js';
import { handleInvoices } from './routes/invoices.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Secret, X-User-Id, X-User-Email, X-User-Name, X-User-Role, X-User-Groups, X-User-Source',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth proxy (public — no auth needed)
    if (pathname.startsWith('/api/auth/')) {
      const result = await handleAuth(pathname, method, request, env);
      if (result) return result;
    }

    // Public stats for Club Hub dashboard
    if (pathname === '/api/hub/stats' && method === 'GET') {
      return handleHubStats(env);
    }

    // Protected API routes
    if (pathname.startsWith('/api/')) {
      const { auth, error } = await requireAuth(request, env);
      if (error) return error;

      // Apply KV role overrides
      const kvRole = await getEffectiveRole(env.KV, auth.user.userId);
      if (kvRole) auth.user.role = kvRole;

      // All routes require at least admin role
      if (auth.user.role !== 'admin' && auth.user.role !== 'superadmin') {
        return json({ error: 'Admin role required for Invoice Hub' }, 403);
      }

      try {
        let result;

        result = await handleSettings(pathname, method, request, env, auth);
        if (result) return result;

        result = await handleEvents(pathname, method, request, env);
        if (result) return result;

        result = await handleUpload(pathname, method, request, env);
        if (result) return result;

        result = await handleInvoices(pathname, method, request, env);
        if (result) return result;

      } catch (err) {
        console.error('API error:', err);
        return json({ error: 'Internal server error', details: err.message }, 500);
      }

      return json({ error: 'Not found' }, 404);
    }

    // Static assets (frontend)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json({ error: 'Not found' }, 404);
  },
};

async function handleHubStats(env) {
  try {
    const allIds = await kvGetList(env.KV, 'invoice-index::all');
    const invoices = (await Promise.all(allIds.map(id => kvGet(env.KV, `invoice::${id}`)))).filter(Boolean);
    const pending = invoices.filter(i => i.status === 'draft').length;
    const committed = invoices.filter(i => i.status === 'committed').length;

    const eventIds = await kvGetList(env.KV, 'event-index');
    return new Response(JSON.stringify({
      appId: 'invoice-hub',
      stats: [
        { label: 'Entwürfe', value: pending, type: pending > 0 ? 'warning' : 'success' },
        { label: 'Gebucht', value: committed, type: 'default' },
        { label: 'Events', value: eventIds.length, type: 'default' },
      ],
      lastUpdated: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch {
    return new Response(JSON.stringify({ appId: 'invoice-hub', stats: [], lastUpdated: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
