/**
 * Settings — Webling accounting defaults + bank/Twint details
 */
import { kvGet, kvPut } from '../kv/store.js';

const DEFAULTS = {
  // Webling accounting
  periodId: '',
  debitAccountId: '',
  creditAccountId: '',
  debitorcategoryId: '',
  // Invoice defaults
  defaultDueDays: 30,
  defaultInvoiceTitle: 'Veranstaltungsbeitrag',
  // Email / payment details
  bankDetails: 'Taekwondo Bern\nIBAN: CH00 0000 0000 0000 0000 0\nBank: PostFinance',
  twintNumber: '',
  senderName: 'Taekwondo Bern',
  senderEmail: 'info@taekwondobern.ch',
};

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleSettings(path, method, request, env, auth) {
  if (path === '/api/settings' && method === 'GET') {
    const stored = (await kvGet(env.KV, 'config::settings')) || {};
    return ok({ settings: { ...DEFAULTS, ...stored } });
  }

  if (path === '/api/settings' && method === 'PUT') {
    if (auth.user.role !== 'admin' && auth.user.role !== 'superadmin') {
      return ok({ error: 'Admin required' }, 403);
    }
    const stored = (await kvGet(env.KV, 'config::settings')) || {};
    const body = await request.json();
    const updated = { ...stored };
    for (const key of Object.keys(DEFAULTS)) {
      if (body[key] !== undefined) updated[key] = body[key];
    }
    await kvPut(env.KV, 'config::settings', updated);
    return ok({ settings: { ...DEFAULTS, ...updated } });
  }

  return null;
}

export async function getSettings(env) {
  const stored = (await kvGet(env.KV, 'config::settings')) || {};
  return { ...DEFAULTS, ...stored };
}
