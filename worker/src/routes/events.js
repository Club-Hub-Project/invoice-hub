/**
 * Events — CRUD for invoice events (camp, tournament, etc.)
 */
import { kvGet, kvPut, kvDelete, kvGetList, kvIndexAdd, kvIndexRemove, generateId } from '../kv/store.js';

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function err(status, msg) { return ok({ error: msg }, status); }

const KEY = {
  event: (id) => `event::${id}`,
  index: 'event-index',
};

export async function handleEvents(path, method, request, env) {
  // GET /api/events
  if (path === '/api/events' && method === 'GET') {
    const ids = await kvGetList(env.KV, KEY.index);
    const events = await Promise.all(ids.map(id => kvGet(env.KV, KEY.event(id))));
    const sorted = events.filter(Boolean).sort((a, b) =>
      (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || '')
    );
    return ok({ events: sorted });
  }

  // POST /api/events
  if (path === '/api/events' && method === 'POST') {
    const body = await request.json();
    if (!body.name) return err(400, 'name is required');
    const id = generateId();
    const event = {
      id,
      name: body.name,
      date: body.date || '',
      fee: Number(body.fee) || 0,
      currency: 'CHF',
      description: body.description || '',
      periodId: body.periodId || '',
      debitorcategoryId: body.debitorcategoryId || '',
      creditAccountId: body.creditAccountId || '',
      debitAccountId: body.debitAccountId || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await kvPut(env.KV, KEY.event(id), event);
    await kvIndexAdd(env.KV, KEY.index, id);
    return ok({ event }, 201);
  }

  // PUT /api/events/:id
  const editMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (editMatch && method === 'PUT') {
    const id = editMatch[1];
    const existing = await kvGet(env.KV, KEY.event(id));
    if (!existing) return err(404, 'Event not found');
    const body = await request.json();
    const updated = {
      ...existing,
      name: body.name ?? existing.name,
      date: body.date ?? existing.date,
      fee: body.fee !== undefined ? Number(body.fee) : existing.fee,
      description: body.description ?? existing.description,
      periodId: body.periodId ?? existing.periodId,
      debitorcategoryId: body.debitorcategoryId ?? existing.debitorcategoryId,
      creditAccountId: body.creditAccountId ?? existing.creditAccountId,
      debitAccountId: body.debitAccountId ?? existing.debitAccountId,
      updatedAt: new Date().toISOString(),
    };
    await kvPut(env.KV, KEY.event(id), updated);
    return ok({ event: updated });
  }

  // DELETE /api/events/:id
  if (editMatch && method === 'DELETE') {
    const id = editMatch[1];
    await kvDelete(env.KV, KEY.event(id));
    await kvIndexRemove(env.KV, KEY.index, id);
    return ok({ success: true });
  }

  return null;
}
