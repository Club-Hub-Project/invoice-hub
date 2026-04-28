/**
 * Invoices — draft CRUD, Webling commit, email text generation
 */
import { kvGet, kvPut, kvDelete, kvGetList, kvIndexAdd, kvIndexRemove, generateId } from '../kv/store.js';
import { WeblingAccountingAdapter } from '../adapters/webling.js';
import { getSettings } from './settings.js';

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function err(status, msg) { return ok({ error: msg }, status); }

const KEY = {
  invoice: (id) => `invoice::${id}`,
  allIndex: 'invoice-index::all',
  eventIndex: (eventId) => `invoice-index::event::${eventId}`,
};

// ---- Email text generator ----

/**
 * Substitute placeholders in an email body template.
 * Supported: [Name], [FirstName], [Article], [Amount], [DueDate], [InvoiceDate], [EventName], [Title]
 */
function applyTemplate(template, invoice) {
  const firstName = (invoice.memberName || '').split(' ')[0] || '';
  const dueDateStr = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('de-CH') : '';
  const invoiceDateStr = invoice.invoiceDate
    ? new Date(invoice.invoiceDate).toLocaleDateString('de-CH') : '';
  const amount = typeof invoice.amount === 'number'
    ? `CHF ${invoice.amount.toFixed(2)}` : `CHF ${invoice.amount || '0.00'}`;

  return template
    .replace(/\[Name\]/g, invoice.memberName || '')
    .replace(/\[FirstName\]/g, firstName)
    .replace(/\[Article\]/g, invoice.itemTitle || '')
    .replace(/\[Amount\]/g, amount)
    .replace(/\[DueDate\]/g, dueDateStr)
    .replace(/\[InvoiceDate\]/g, invoiceDateStr)
    .replace(/\[EventName\]/g, invoice.eventName || '')
    .replace(/\[Title\]/g, invoice.invoiceTitle || invoice.eventName || '');
}

function generateEmailText(invoice, settings) {
  const firstName = (invoice.memberName || '').split(' ')[0] || 'Mitglied';
  const dueDateStr = invoice.dueDate
    ? new Date(invoice.dueDate).toLocaleDateString('de-CH')
    : '30 Tage nach Rechnungsdatum';
  const invoiceDateStr = invoice.invoiceDate
    ? new Date(invoice.invoiceDate).toLocaleDateString('de-CH')
    : new Date().toLocaleDateString('de-CH');
  const amount = typeof invoice.amount === 'number' ? invoice.amount.toFixed(2) : invoice.amount;

  // If a custom template body was stored, use it (with subject prepended)
  if (invoice.emailBodyTemplate) {
    const subject = invoice.emailSubject
      || `Rechnung - ${invoice.invoiceTitle || invoice.eventName || 'Veranstaltung'}`;
    const body = applyTemplate(invoice.emailBodyTemplate, invoice);
    return `Betreff: ${subject}\n\n${body}`;
  }

  // Auto-generated fallback
  const lines = [
    `Betreff: ${invoice.emailSubject || `Rechnung - ${invoice.invoiceTitle || invoice.eventName || 'Veranstaltung'}`}`,
    '',
    `Liebe/r ${firstName},`,
    '',
    `anbei die Rechnung:`,
  ];

  if (invoice.itemTitle) {
    lines.push(`  Artikel:             ${invoice.itemTitle}`);
  }

  lines.push(
    `  Betrag:              CHF ${amount}`,
    `  Rechnungsdatum:      ${invoiceDateStr}`,
    `  Zahlbar bis:         ${dueDateStr}`,
    `  Verwendungszweck:    ${invoice.invoiceTitle || invoice.eventName} - ${invoice.memberName}`,
    '',
  );

  if (settings.bankDetails) {
    lines.push('Bankverbindung:');
    lines.push(...settings.bankDetails.split('\n').map(l => `  ${l}`));
    lines.push('');
  }

  if (settings.twintNumber) {
    lines.push(`Twint: ${settings.twintNumber}`);
    lines.push('');
  }

  lines.push(
    'Bei Fragen stehen wir dir gerne zur Verfügung.',
    '',
    'Freundliche Grüsse',
    settings.senderName || 'Taekwondo Bern',
  );

  return lines.join('\n');
}

// ---- Route handler ----

export async function handleInvoices(path, method, request, env) {
  // GET /api/invoices
  if (path === '/api/invoices' && method === 'GET') {
    const url = new URL(request.url);
    const eventId = url.searchParams.get('eventId');
    const status = url.searchParams.get('status'); // draft | committed | all

    let ids;
    if (eventId) {
      ids = await kvGetList(env.KV, KEY.eventIndex(eventId));
    } else {
      ids = await kvGetList(env.KV, KEY.allIndex);
    }

    const invoices = (await Promise.all(ids.map(id => kvGet(env.KV, KEY.invoice(id))))).filter(Boolean);

    const filtered = status && status !== 'all'
      ? invoices.filter(inv => inv.status === status)
      : invoices;

    filtered.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return ok({ invoices: filtered, total: filtered.length });
  }

  // POST /api/invoices — create one or more drafts from upload results
  if (path === '/api/invoices' && method === 'POST') {
    const body = await request.json();
    // body: { eventId, rows, invoiceTitle, emailSubject, emailBodyTemplate }
    if (!body.eventId) return err(400, 'eventId is required');
    if (!Array.isArray(body.rows) || !body.rows.length) return err(400, 'rows is required');

    const event = await kvGet(env.KV, `event::${body.eventId}`);
    if (!event) return err(404, 'Event not found');

    const settings = await getSettings(env);
    const today = new Date().toISOString().split('T')[0];
    const dueDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + (settings.defaultDueDays || 30));
      return d.toISOString().split('T')[0];
    })();

    // Batch-level fields (shared across all invoices in this upload)
    const invoiceTitle = body.invoiceTitle || body.title || settings.defaultInvoiceTitle || event.name;
    const emailSubject = body.emailSubject || '';
    const emailBodyTemplate = body.emailBodyTemplate || '';

    const created = [];
    for (const row of body.rows) {
      const isExternal = row.isExternal === true || row.memberId === '__external__';
      if (!row.memberId && !isExternal) continue; // skip truly unmatched
      const id = generateId();
      const amount = row.customAmount ?? event.fee;
      const invoice = {
        id,
        eventId: event.id,
        eventName: event.name,
        memberId: isExternal ? null : String(row.memberId),
        isExternal,
        memberName: row.memberName || '',
        memberEmail: row.memberEmail || '',
        amount,
        invoiceTitle,           // debitor entry title (e.g. "Gürtelprüfung Februar 2026")
        itemTitle: row.itemTitle || '', // line-item / article (e.g. "Gürtelprüfung Blaugurt")
        emailSubject,
        emailBodyTemplate,
        invoiceDate: today,
        dueDate,
        status: 'draft',
        periodId: event.periodId || settings.periodId || '',
        debitorcategoryId: event.debitorcategoryId || settings.debitorcategoryId || '',
        creditAccountId: event.creditAccountId || settings.creditAccountId || '',
        debitAccountId: event.debitAccountId || settings.debitAccountId || '',
        weblingDebitorId: null,
        createdAt: new Date().toISOString(),
        committedAt: null,
      };
      await kvPut(env.KV, KEY.invoice(id), invoice);
      await kvIndexAdd(env.KV, KEY.allIndex, id);
      await kvIndexAdd(env.KV, KEY.eventIndex(event.id), id);
      created.push(invoice);
    }

    return ok({ invoices: created, created: created.length }, 201);
  }

  // PUT /api/invoices/:id
  const idMatch = path.match(/^\/api\/invoices\/([^/]+)$/);
  if (idMatch && method === 'PUT') {
    const id = idMatch[1];
    const invoice = await kvGet(env.KV, KEY.invoice(id));
    if (!invoice) return err(404, 'Invoice not found');
    if (invoice.status === 'committed') return err(400, 'Cannot edit a committed invoice');

    const body = await request.json();
    const updated = {
      ...invoice,
      title: body.title ?? invoice.title,
      amount: body.amount !== undefined ? Number(body.amount) : invoice.amount,
      invoiceDate: body.invoiceDate ?? invoice.invoiceDate,
      dueDate: body.dueDate ?? invoice.dueDate,
      memberName: body.memberName ?? invoice.memberName,
      memberEmail: body.memberEmail ?? invoice.memberEmail,
      periodId: body.periodId ?? invoice.periodId,
      debitorcategoryId: body.debitorcategoryId ?? invoice.debitorcategoryId,
      creditAccountId: body.creditAccountId ?? invoice.creditAccountId,
      debitAccountId: body.debitAccountId ?? invoice.debitAccountId,
      updatedAt: new Date().toISOString(),
    };
    await kvPut(env.KV, KEY.invoice(id), updated);
    return ok({ invoice: updated });
  }

  // DELETE /api/invoices/:id
  if (idMatch && method === 'DELETE') {
    const id = idMatch[1];
    const invoice = await kvGet(env.KV, KEY.invoice(id));
    if (!invoice) return err(404, 'Invoice not found');
    await kvDelete(env.KV, KEY.invoice(id));
    await kvIndexRemove(env.KV, KEY.allIndex, id);
    if (invoice.eventId) await kvIndexRemove(env.KV, KEY.eventIndex(invoice.eventId), id);
    return ok({ success: true });
  }

  // POST /api/invoices/:id/commit — commit single invoice to Webling
  const commitMatch = path.match(/^\/api\/invoices\/([^/]+)\/commit$/);
  if (commitMatch && method === 'POST') {
    const id = commitMatch[1];
    return commitInvoice(env, id);
  }

  // GET /api/invoices/:id/email — get email text for an invoice
  const emailMatch = path.match(/^\/api\/invoices\/([^/]+)\/email$/);
  if (emailMatch && method === 'GET') {
    const id = emailMatch[1];
    const invoice = await kvGet(env.KV, KEY.invoice(id));
    if (!invoice) return err(404, 'Invoice not found');
    const settings = await getSettings(env);
    const emailText = generateEmailText(invoice, settings);
    return ok({ emailText, invoice });
  }

  // POST /api/invoices/bulk/commit
  if (path === '/api/invoices/bulk/commit' && method === 'POST') {
    const body = await request.json();
    const ids = body.ids || [];
    if (!ids.length) return err(400, 'ids is required');

    const results = await Promise.allSettled(ids.map(id => commitInvoice(env, id, true)));
    const committed = results.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
    const errors = results.filter(r => r.status === 'rejected' || r.value?.error)
      .map(r => r.reason?.message || r.value?.error || 'Unknown error');

    return ok({ committed, errors, total: ids.length });
  }

  // POST /api/invoices/bulk/delete
  if (path === '/api/invoices/bulk/delete' && method === 'POST') {
    const body = await request.json();
    const ids = body.ids || [];
    for (const id of ids) {
      const invoice = await kvGet(env.KV, KEY.invoice(id));
      if (!invoice) continue;
      await kvDelete(env.KV, KEY.invoice(id));
      await kvIndexRemove(env.KV, KEY.allIndex, id);
      if (invoice.eventId) await kvIndexRemove(env.KV, KEY.eventIndex(invoice.eventId), id);
    }
    return ok({ deleted: ids.length });
  }

  // Webling accounting metadata
  if (path === '/api/webling/periods' && method === 'GET') {
    try {
      const adapter = new WeblingAccountingAdapter(env);
      const periods = await adapter.getPeriods();
      return ok({ periods });
    } catch (e) {
      return err(500, e.message);
    }
  }

  if (path === '/api/webling/accounts' && method === 'GET') {
    try {
      const adapter = new WeblingAccountingAdapter(env);
      const accounts = await adapter.getAccounts();
      return ok({ accounts });
    } catch (e) {
      return err(500, e.message);
    }
  }

  if (path === '/api/webling/categories' && method === 'GET') {
    try {
      const adapter = new WeblingAccountingAdapter(env);
      const categories = await adapter.getDebitorcategories();
      return ok({ categories });
    } catch (e) {
      return err(500, e.message);
    }
  }

  return null;
}

async function commitInvoice(env, id, returnObject = false) {
  const ok_ = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const invoice = await kvGet(env.KV, KEY.invoice(id));
  if (!invoice) {
    if (returnObject) return { error: `Invoice ${id} not found` };
    return ok_({ error: 'Invoice not found' });
  }
  if (invoice.isExternal) {
    if (returnObject) return { error: 'Externe Rechnungen können nicht in Webling gebucht werden' };
    return ok_({ error: 'Externe Rechnungen können nicht in Webling gebucht werden' });
  }
  if (invoice.status === 'committed') {
    if (returnObject) return { error: 'Already committed', weblingDebitorId: invoice.weblingDebitorId };
    return ok_({ error: 'Already committed', weblingDebitorId: invoice.weblingDebitorId });
  }
  if (!invoice.periodId) {
    if (returnObject) return { error: 'periodId is required to commit to Webling' };
    return ok_({ error: 'periodId is required — configure it in Settings or on the Event' });
  }

  const adapter = new WeblingAccountingAdapter(env);
  const { id: weblingDebitorId } = await adapter.createInvoice({
    memberId: invoice.memberId,
    periodId: invoice.periodId,
    title: invoice.invoiceTitle || invoice.eventName,   // debitor entry title
    itemTitle: invoice.itemTitle || invoice.invoiceTitle || invoice.eventName, // line-item
    date: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    amount: invoice.amount,
    debitorcategoryId: invoice.debitorcategoryId || '',
    creditAccountId: invoice.creditAccountId || '',
    debitAccountId: invoice.debitAccountId || '',
  });

  const settings = await getSettings(env);
  const updated = {
    ...invoice,
    status: 'committed',
    weblingDebitorId,
    committedAt: new Date().toISOString(),
    emailText: generateEmailText({ ...invoice, weblingDebitorId }, settings),
  };
  await kvPut(env.KV, KEY.invoice(id), updated);

  if (returnObject) return { success: true, invoice: updated };
  return ok_({ success: true, invoice: updated });
}
