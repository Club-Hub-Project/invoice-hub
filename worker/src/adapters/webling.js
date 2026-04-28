/**
 * Invoice Hub — Webling Accounting Adapter
 * Handles periods, accounts, debitor categories and invoice creation.
 * Member search is delegated to USER_CONNECTOR service binding.
 */

export class WeblingAccountingAdapter {
  constructor(env) {
    this.baseUrl = env.WEBLING_BASE_URL || 'https://tkdbern.webling.ch/api/1';
    this.apiKey = env.WEBLING_API_KEY;
  }

  async apiFetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        apikey: this.apiKey,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Webling (${res.status}): ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('json') ? res.json() : res.text();
  }

  toArray(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      return Object.entries(raw).map(([id, v]) => ({
        id: Number(id),
        ...(typeof v === 'object' ? v : {}),
      }));
    }
    return [];
  }

  async getPeriods() {
    try {
      const raw = await this.apiFetch('/period?format=full');
      return this.toArray(raw)
        .map(p => ({
          id: String(p.id),
          title: p.properties?.title || `Period ${p.id}`,
          from: p.properties?.from || '',
          to: p.properties?.to || '',
        }))
        .sort((a, b) => b.from.localeCompare(a.from));
    } catch { return []; }
  }

  async getAccounts() {
    try {
      const raw = await this.apiFetch('/account?format=full');
      return this.toArray(raw)
        .map(a => ({
          id: String(a.id),
          title: a.properties?.title || `Account ${a.id}`,
          number: a.properties?.number || '',
        }))
        .sort((a, b) => (a.number || a.title).localeCompare(b.number || b.title));
    } catch { return []; }
  }

  async getDebitorcategories() {
    try {
      const raw = await this.apiFetch('/debitorcategory?format=full');
      return this.toArray(raw).map(c => ({
        id: String(c.id),
        title: c.properties?.title || `Category ${c.id}`,
      }));
    } catch { return []; }
  }

  async createInvoice({ memberId, periodId, title, date, dueDate, amount, debitorcategoryId, creditAccountId, debitAccountId }) {
    const body = {
      properties: {
        title: title || 'Veranstaltungsbeitrag',
        date: date || new Date().toISOString().split('T')[0],
        duedate: dueDate || '',
      },
      parents: [Number(periodId)],
      links: {
        member: [Number(memberId)],
        revenue: [{
          properties: {
            amount: Number(amount),
            title: title || 'Veranstaltungsbeitrag',
          },
          parents: [{
            properties: {
              date: date || new Date().toISOString().split('T')[0],
              title: title || 'Veranstaltungsbeitrag',
            },
            parents: [Number(periodId)],
          }],
          links: {
            ...(debitAccountId ? { debit: [Number(debitAccountId)] } : {}),
            ...(creditAccountId ? { credit: [Number(creditAccountId)] } : {}),
          },
        }],
        ...(debitorcategoryId ? { debitorcategory: [Number(debitorcategoryId)] } : {}),
      },
    };

    const result = await this.apiFetch('/debitor', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return { id: String(result) };
  }
}

/**
 * Search members via the USER_CONNECTOR service binding.
 */
export async function searchMembers(env, query) {
  if (!env.USER_CONNECTOR) return [];
  const res = await env.USER_CONNECTOR.fetch(
    new Request(`https://connector/users/search?q=${encodeURIComponent(query)}`)
  );
  if (!res.ok) return [];
  return res.json();
}
