/**
 * Invoice Hub — Frontend SPA
 */

// ---- Auth / API ----

const TOKEN_KEY = 'invoice_hub_token';

function getToken() {
  // Hub mode: token from postMessage
  if (window._hubToken) return window._hubToken;
  return localStorage.getItem(TOKEN_KEY);
}

async function api(method, path, body) {
  const token = getToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login.html';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

const GET = (p) => api('GET', p);
const POST = (p, b) => api('POST', p, b);
const PUT = (p, b) => api('PUT', p, b);
const DEL = (p) => api('DELETE', p);

// ---- Toast ----

function toast(msg, type = 'success', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ---- Router ----

let currentView = 'dashboard';
let viewsLoaded = {};

function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));

  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) viewEl.classList.add('active');

  const navBtn = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');

  currentView = view;

  // Load view content
  if (!viewsLoaded[view]) {
    viewsLoaded[view] = true;
    loadView(view);
  } else if (view === 'invoices' || view === 'events' || view === 'dashboard') {
    loadView(view); // always refresh these
  }
}

function loadView(view) {
  switch (view) {
    case 'dashboard': loadDashboard(); break;
    case 'events': loadEvents(); break;
    case 'upload': loadUpload(); break;
    case 'invoices': loadInvoices(); break;
    case 'settings': loadSettings(); break;
  }
}

// ---- Navigation wiring ----

document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.view));
});

// ---- Hub postMessage bridge ----

window.addEventListener('message', (e) => {
  if (e.data?.type === 'HUB_AUTH' && e.data.token) {
    window._hubToken = e.data.token;
    initApp();
  }
});

// ---- Init ----

async function initApp() {
  try {
    const data = await GET('/api/auth/me');
    const user = data.user;

    if (user.role !== 'admin' && user.role !== 'superadmin') {
      document.querySelector('.main').innerHTML = '<div style="padding:2rem;color:#dc2626">Zugang nur für Admins.</div>';
      return;
    }

    document.getElementById('user-name').textContent = user.displayName || user.email || '—';
    document.getElementById('user-role').textContent = user.role;
    document.getElementById('user-avatar').textContent = (user.displayName || user.email || '?')[0].toUpperCase();

    navigate('dashboard');
  } catch {
    window.location.href = '/login.html';
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/login.html';
});

// Auto-init if not in hub
if (!window.parent || window.parent === window) {
  initApp();
} else {
  window.parent.postMessage({ type: 'APP_READY' }, '*');
  setTimeout(() => {
    if (!window._hubToken) initApp(); // fallback
  }, 800);
}

// ---- Dashboard ----

async function loadDashboard() {
  const el = document.getElementById('dashboard-content');
  el.innerHTML = '<div class="loading">Wird geladen...</div>';

  try {
    const [statsData, eventsData, invoicesData] = await Promise.all([
      GET('/api/hub/stats').catch(() => ({ stats: [] })),
      GET('/api/events'),
      GET('/api/invoices'),
    ]);

    const events = eventsData.events || [];
    const invoices = invoicesData.invoices || [];
    const drafts = invoices.filter(i => i.status === 'draft');
    const committed = invoices.filter(i => i.status === 'committed');
    const totalAmount = drafts.reduce((s, i) => s + (i.amount || 0), 0);

    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">${events.length}</div>
          <div class="stat-label">Events</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${drafts.length}</div>
          <div class="stat-label">Entwürfe</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${committed.length}</div>
          <div class="stat-label">In Webling</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">CHF ${totalAmount.toFixed(0)}</div>
          <div class="stat-label">Offen (Entwürfe)</div>
        </div>
      </div>

      ${events.length > 0 ? `
        <div class="card">
          <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:0.75rem">Letzte Events</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Datum</th><th>Betrag</th><th>Rechnungen</th></tr></thead>
              <tbody>
                ${events.slice(0, 5).map(ev => {
                  const count = invoices.filter(i => i.eventId === ev.id).length;
                  return `<tr>
                    <td><strong>${esc(ev.name)}</strong></td>
                    <td>${ev.date ? new Date(ev.date).toLocaleDateString('de-CH') : '—'}</td>
                    <td>CHF ${(ev.fee || 0).toFixed(2)}</td>
                    <td>${count}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : `
        <div class="card">
          <div class="empty-state">
            <div class="empty-icon">🧾</div>
            <h3>Noch keine Events</h3>
            <p>Erstelle einen Event, lade eine CSV hoch und buche Rechnungen in Webling.</p>
            <div style="margin-top:1rem">
              <button class="btn btn-primary" onclick="navigate('events')">+ Neuer Event</button>
            </div>
          </div>
        </div>
      `}

      ${drafts.length > 0 ? `
        <div class="card">
          <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:0.75rem">Ausstehende Entwürfe</h3>
          <p style="color:var(--text-secondary);font-size:0.82rem;margin-bottom:0.75rem">${drafts.length} Rechnung(en) noch nicht in Webling gebucht.</p>
          <button class="btn btn-primary btn-sm" onclick="navigate('invoices')">Rechnungen ansehen →</button>
        </div>
      ` : ''}
    `;
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><h3>Fehler</h3><p>${e.message}</p></div>`;
  }
}

// ---- Events ----

let weblingMeta = { periods: [], accounts: [], categories: [] };
let editingEventId = null;

async function loadEvents() {
  const el = document.getElementById('events-content');
  el.innerHTML = '<div class="loading">Wird geladen...</div>';

  // Load Webling metadata for modal dropdowns
  loadWeblingMeta();

  try {
    const data = await GET('/api/events');
    const events = data.events || [];

    if (!events.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <h3>Noch keine Events</h3>
          <p>Klicke auf "+ Neuer Event", um zu beginnen.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Datum</th><th>Betrag</th><th>Beschreibung</th><th>Aktionen</th></tr></thead>
          <tbody id="events-tbody">
            ${events.map(ev => `
              <tr data-id="${ev.id}">
                <td><strong>${esc(ev.name)}</strong></td>
                <td>${ev.date ? new Date(ev.date).toLocaleDateString('de-CH') : '—'}</td>
                <td>CHF ${(ev.fee || 0).toFixed(2)}</td>
                <td style="color:var(--text-secondary);font-size:0.82rem">${esc(ev.description || '—')}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-sm btn-edit-event" data-id="${ev.id}" title="Bearbeiten">✏️</button>
                    <button class="btn btn-sm btn-upload-event" data-id="${ev.id}" title="CSV hochladen" style="color:var(--accent)">📤</button>
                    <button class="btn btn-sm btn-delete-event" data-id="${ev.id}" title="Löschen" style="color:#dc2626">🗑</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('events-tbody').addEventListener('click', async (e) => {
      const editBtn = e.target.closest('.btn-edit-event');
      if (editBtn) { openEventModal(editBtn.dataset.id); return; }

      const uploadBtn = e.target.closest('.btn-upload-event');
      if (uploadBtn) {
        selectedEventId = uploadBtn.dataset.id;
        navigate('upload');
        return;
      }

      const deleteBtn = e.target.closest('.btn-delete-event');
      if (deleteBtn) {
        if (!confirm('Event löschen? Bestehende Rechnungen bleiben erhalten.')) return;
        try {
          await DEL(`/api/events/${deleteBtn.dataset.id}`);
          toast('Event gelöscht');
          loadEvents();
        } catch (err) {
          toast(err.message, 'error');
        }
      }
    });

  } catch (e) {
    el.innerHTML = `<div class="empty-state"><h3>Fehler</h3><p>${e.message}</p></div>`;
  }
}

async function loadWeblingMeta() {
  try {
    const [p, a, c] = await Promise.all([
      GET('/api/webling/periods'),
      GET('/api/webling/accounts'),
      GET('/api/webling/categories'),
    ]);
    weblingMeta.periods = p.periods || [];
    weblingMeta.accounts = a.accounts || [];
    weblingMeta.categories = c.categories || [];
    populateModalDropdowns();
  } catch { /* offline / no API key */ }
}

function populateModalDropdowns() {
  const periodSel = document.getElementById('ev-period');
  const debitSel = document.getElementById('ev-debit');
  const creditSel = document.getElementById('ev-credit');
  const catSel = document.getElementById('ev-debitorcat');

  const base = '<option value="">– aus Einstellungen –</option>';
  periodSel.innerHTML = base + weblingMeta.periods.map(p => `<option value="${p.id}">${esc(p.title)}</option>`).join('');
  debitSel.innerHTML = base + weblingMeta.accounts.map(a => `<option value="${a.id}">${esc(a.number ? `${a.number} ${a.title}` : a.title)}</option>`).join('');
  creditSel.innerHTML = base + weblingMeta.accounts.map(a => `<option value="${a.id}">${esc(a.number ? `${a.number} ${a.title}` : a.title)}</option>`).join('');
  catSel.innerHTML = '<option value="">– keine –</option>' + weblingMeta.categories.map(c => `<option value="${c.id}">${esc(c.title)}</option>`).join('');
}

async function openEventModal(eventId = null) {
  editingEventId = eventId;
  document.getElementById('modal-event-title').textContent = eventId ? 'Event bearbeiten' : 'Neuer Event';

  // Reset form
  document.getElementById('ev-name').value = '';
  document.getElementById('ev-date').value = '';
  document.getElementById('ev-fee').value = '';
  document.getElementById('ev-description').value = '';
  document.getElementById('ev-period').value = '';
  document.getElementById('ev-debit').value = '';
  document.getElementById('ev-credit').value = '';
  document.getElementById('ev-debitorcat').value = '';

  if (eventId) {
    try {
      const data = await GET('/api/events');
      const ev = (data.events || []).find(e => e.id === eventId);
      if (ev) {
        document.getElementById('ev-name').value = ev.name;
        document.getElementById('ev-date').value = ev.date || '';
        document.getElementById('ev-fee').value = ev.fee || '';
        document.getElementById('ev-description').value = ev.description || '';
        document.getElementById('ev-period').value = ev.periodId || '';
        document.getElementById('ev-debit').value = ev.debitAccountId || '';
        document.getElementById('ev-credit').value = ev.creditAccountId || '';
        document.getElementById('ev-debitorcat').value = ev.debitorcategoryId || '';
      }
    } catch { /* proceed empty */ }
  }

  document.getElementById('modal-event').style.display = 'flex';
}

document.getElementById('btn-new-event').addEventListener('click', () => openEventModal());
document.getElementById('modal-event-close').addEventListener('click', () => { document.getElementById('modal-event').style.display = 'none'; });
document.getElementById('modal-event-cancel').addEventListener('click', () => { document.getElementById('modal-event').style.display = 'none'; });

document.getElementById('form-event').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: document.getElementById('ev-name').value.trim(),
    date: document.getElementById('ev-date').value,
    fee: parseFloat(document.getElementById('ev-fee').value) || 0,
    description: document.getElementById('ev-description').value.trim(),
    periodId: document.getElementById('ev-period').value,
    debitAccountId: document.getElementById('ev-debit').value,
    creditAccountId: document.getElementById('ev-credit').value,
    debitorcategoryId: document.getElementById('ev-debitorcat').value,
  };

  try {
    if (editingEventId) {
      await PUT(`/api/events/${editingEventId}`, payload);
      toast('Event aktualisiert');
    } else {
      await POST('/api/events', payload);
      toast('Event erstellt');
    }
    document.getElementById('modal-event').style.display = 'none';
    loadEvents();
    viewsLoaded['dashboard'] = false;
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---- Upload ----

let selectedEventId = null;
let uploadRows = [];
let uploadStats = {};
let uploadStep = 1;

function loadUpload() {
  const el = document.getElementById('upload-content');
  uploadStep = 1;
  uploadRows = [];

  el.innerHTML = `
    <div class="steps">
      <div class="step active" id="step-tab-1">1. Event wählen</div>
      <div class="step" id="step-tab-2">2. CSV hochladen</div>
      <div class="step" id="step-tab-3">3. Prüfen &amp; Importieren</div>
    </div>
    <div id="upload-step-content"></div>
  `;

  renderUploadStep(1);
}

async function renderUploadStep(step) {
  uploadStep = step;
  document.querySelectorAll('.step').forEach((s, i) => {
    s.className = 'step' + (i + 1 < step ? ' done' : i + 1 === step ? ' active' : '');
  });

  const content = document.getElementById('upload-step-content');

  if (step === 1) {
    let eventsHtml = '<div class="loading">Events werden geladen...</div>';
    try {
      const data = await GET('/api/events');
      const events = data.events || [];
      if (!events.length) {
        eventsHtml = `<div class="empty-state"><h3>Kein Event vorhanden</h3><p><button class="btn btn-primary btn-sm" onclick="navigate('events')">Event erstellen</button></p></div>`;
      } else {
        eventsHtml = `
          <div class="card">
            <div class="form-group">
              <label class="form-label">Event auswählen *</label>
              <select class="form-input" id="upload-event-sel" style="max-width:400px">
                <option value="">— bitte wählen —</option>
                ${events.map(ev => `<option value="${ev.id}" ${ev.id === selectedEventId ? 'selected' : ''}>${esc(ev.name)}${ev.date ? ` (${new Date(ev.date).toLocaleDateString('de-CH')})` : ''} — CHF ${(ev.fee||0).toFixed(2)}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn-primary" id="btn-step1-next">Weiter →</button>
          </div>
        `;
      }
    } catch (e) {
      eventsHtml = `<div class="empty-state"><h3>Fehler</h3><p>${e.message}</p></div>`;
    }
    content.innerHTML = eventsHtml;
    document.getElementById('btn-step1-next')?.addEventListener('click', () => {
      const sel = document.getElementById('upload-event-sel');
      if (!sel.value) { toast('Bitte Event auswählen', 'error'); return; }
      selectedEventId = sel.value;
      renderUploadStep(2);
    });
  }

  else if (step === 2) {
    content.innerHTML = `
      <div class="card">
        <div class="upload-zone" id="upload-zone">
          <div class="upload-icon">📄</div>
          <div class="upload-label">CSV-Datei hierher ziehen oder klicken</div>
          <div class="upload-hint">Spalten: Vorname, Name (oder Vollständiger Name), optional E-Mail, Betrag<br>Trennzeichen: Semikolon oder Komma</div>
        </div>
        <input type="file" id="csv-file-input" accept=".csv,text/csv" style="display:none">
        <div id="upload-error" style="color:#dc2626;margin-top:0.75rem;display:none"></div>
        <div style="margin-top:1rem;display:flex;gap:0.5rem">
          <button class="btn" onclick="renderUploadStep(1)">← Zurück</button>
        </div>
      </div>
    `;

    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('csv-file-input');

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) processCSVFile(file);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) processCSVFile(fileInput.files[0]);
    });
  }

  else if (step === 3) {
    const matched = uploadRows.filter(r => r.matchStatus === 'matched');
    const hasAmountCol = uploadStats.hasAmountColumn;
    const hasArticleCol = uploadStats.hasArticleColumn;
    // Show invoice form whenever there are any resolvable rows (matched, multiple, or unmatched with suggestions)
    const hasAnyResolvable = matched.length > 0
      || uploadRows.some(r => r.matchStatus === 'multiple' || (r.matchStatus === 'unmatched' && r.suggestions?.length > 0));

    // Suggest a default invoice title from the event name
    let defaultTitle = '';
    try {
      const evData = await GET('/api/events');
      const ev = (evData.events || []).find(e => e.id === selectedEventId);
      if (ev) defaultTitle = ev.name;
    } catch { /* fine */ }

    content.innerHTML = `
      <div class="card">
        <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:0.5rem">Ergebnis: ${uploadRows.length} Zeilen</h3>
        <div style="display:flex;gap:1rem;margin-bottom:1rem;font-size:0.82rem">
          <span id="stat-matched" style="color:#16a34a">✅ ${matched.length} zugeordnet</span>
          <span id="stat-unmatched" style="color:#dc2626">❌ ${uploadRows.filter(r=>r.matchStatus==='unmatched').length} kein Treffer</span>
          <span id="stat-multiple" style="color:#b45309">⚠️ ${uploadRows.filter(r=>r.matchStatus==='multiple').length} mehrere Treffer</span>
        </div>

        <div style="max-height:280px;overflow-y:auto;margin-bottom:1.25rem;border:1px solid var(--border);border-radius:8px;padding:0.5rem">
          ${uploadRows.map((r, i) => `
            <div class="match-row" id="match-row-${i}">
              <div class="match-name">
                ${esc(r.name || '—')}
                ${r.itemTitle ? `<span style="font-size:0.75rem;color:var(--text-secondary);margin-left:0.4rem">${esc(r.itemTitle)}</span>` : ''}
              </div>
              <span class="badge badge-${r.matchStatus} match-badge">${
                r.matchStatus === 'matched' ? '✅ ' + esc(r.memberName || '') :
                r.matchStatus === 'multiple' ? '⚠️ mehrere' : '❌ kein Treffer'
              }</span>
              ${r.matchStatus === 'multiple' ? `
                <select class="form-input" style="max-width:200px;padding:0.3rem 0.5rem;font-size:0.78rem" onchange="pickMatch(${i},this,'multiple')">
                  <option value="">— wählen —</option>
                  ${(r.matches||[]).map(m => `<option value="${m.id}">${esc(m.displayName)} — ${esc(m.email||'')}</option>`).join('')}
                </select>
              ` : ''}
              ${r.matchStatus === 'unmatched' && r.suggestions?.length > 0 ? `
                <select class="form-input" style="max-width:200px;padding:0.3rem 0.5rem;font-size:0.78rem" onchange="pickMatch(${i},this,'unmatched')">
                  <option value="">— ggf. zuordnen —</option>
                  ${(r.suggestions||[]).map(m => `<option value="${m.id}">${esc(m.displayName)} — ${esc(m.email||'')}</option>`).join('')}
                </select>
              ` : ''}
              ${r.customAmount != null ? `<span style="font-size:0.75rem;font-weight:600;color:var(--accent)">CHF ${r.customAmount.toFixed(2)}</span>` : ''}
            </div>
          `).join('')}
        </div>

        ${hasAnyResolvable ? `
          <div style="border-top:1px solid var(--border);padding-top:1.25rem;margin-bottom:1rem">
            <h3 style="font-size:0.9rem;font-weight:700;margin-bottom:0.75rem">Rechnungsdetails</h3>

            <div class="form-group">
              <label class="form-label">Rechnungstitel *
                <span style="font-weight:400;color:var(--text-secondary)">(erscheint in Webling)</span>
              </label>
              <input class="form-input" type="text" id="upload-inv-title" value="${esc(defaultTitle)}" placeholder="z.B. Gürtelprüfung Februar 2026" style="max-width:480px">
            </div>

            <div class="form-group">
              <label class="form-label">E-Mail Betreff</label>
              <input class="form-input" type="text" id="upload-email-subject" placeholder="Rechnung ${esc(defaultTitle)}" style="max-width:480px">
            </div>

            <div class="form-group">
              <label class="form-label">E-Mail Text
                <span style="font-weight:400;color:var(--text-secondary);font-size:0.75rem">
                  Platzhalter: [FirstName], [Name]${hasArticleCol ? ', [Article]' : ''}, [Amount], [DueDate], [Title]
                </span>
              </label>
              <textarea class="form-input" id="upload-email-body" rows="7" placeholder="Liebe/r [FirstName],&#10;&#10;anbei die Rechnung für [Title].&#10;${hasArticleCol ? '&#10;Artikel: [Article]' : ''}&#10;Betrag: [Amount]&#10;Zahlbar bis: [DueDate]&#10;&#10;Freundliche Grüsse&#10;Taekwondo Bern"></textarea>
            </div>

            ${hasAmountCol ? `<p style="font-size:0.8rem;color:var(--accent);margin-bottom:0.75rem">💡 Individuelle Beträge aus der CSV-Spalte "Betrag" werden verwendet.</p>` : ''}
            ${hasArticleCol ? `<p style="font-size:0.8rem;color:var(--accent);margin-bottom:0.75rem">💡 Artikel aus der CSV-Spalte werden als Rechnungsposition und als [Article]-Platzhalter verwendet.</p>` : ''}
          </div>
        ` : `<p style="color:#dc2626;font-size:0.875rem">Keine Mitglieder konnten zugeordnet werden. Bitte CSV prüfen.</p>`}

        <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
          <button class="btn" onclick="renderUploadStep(2)">← Zurück</button>
          ${hasAnyResolvable ? `<button class="btn btn-primary" id="btn-create-invoices">🧾 ${matched.length} Rechnung(en) erstellen</button>` : ''}
        </div>
      </div>
    `;

    document.getElementById('btn-create-invoices')?.addEventListener('click', createInvoicesFromUpload);
  }
}

async function processCSVFile(file) {
  const errEl = document.getElementById('upload-error');
  errEl.style.display = 'none';

  try {
    const zone = document.getElementById('upload-zone');
    zone.innerHTML = '<div class="upload-icon">⏳</div><div class="upload-label">Wird verarbeitet...</div>';

    const formData = new FormData();
    formData.append('file', file);

    const token = getToken();
    const res = await fetch('/api/upload/csv', {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData,
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    uploadRows = data.rows || [];
    uploadStats = data.stats || {};
    renderUploadStep(3);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
    // Reset zone
    document.getElementById('upload-zone').innerHTML = `
      <div class="upload-icon">📄</div>
      <div class="upload-label">CSV-Datei hierher ziehen oder klicken</div>
      <div class="upload-hint">Spalten: Vorname, Name, optional E-Mail, Betrag</div>
    `;
  }
}

async function createInvoicesFromUpload() {
  const btn = document.getElementById('btn-create-invoices');
  const invoiceTitle = document.getElementById('upload-inv-title')?.value.trim() || '';
  const emailSubject = document.getElementById('upload-email-subject')?.value.trim() || '';
  const emailBodyTemplate = document.getElementById('upload-email-body')?.value.trim() || '';

  if (!invoiceTitle) {
    toast('Bitte Rechnungstitel eingeben', 'error');
    document.getElementById('upload-inv-title')?.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Wird erstellt...';

  const rows = uploadRows.filter(r => r.matchStatus === 'matched' && r.memberId);

  try {
    const data = await POST('/api/invoices', {
      eventId: selectedEventId,
      rows,
      invoiceTitle,
      emailSubject,
      emailBodyTemplate,
    });
    toast(`${data.created} Rechnung(en) erstellt`, 'success');
    uploadRows = [];
    uploadStats = {};
    viewsLoaded['invoices'] = false;
    viewsLoaded['dashboard'] = false;
    navigate('invoices');
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = `🧾 Rechnung(en) erstellen`;
  }
}

// ---- Invoices ----

let invoiceFilter = { status: 'all', eventId: '' };
let allInvoices = [];
let allEvents = [];

async function loadInvoices() {
  const el = document.getElementById('invoices-content');
  el.innerHTML = '<div class="loading">Wird geladen...</div>';

  try {
    const [invData, evData] = await Promise.all([GET('/api/invoices'), GET('/api/events')]);
    allInvoices = invData.invoices || [];
    allEvents = evData.events || [];
    renderInvoiceList(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><h3>Fehler</h3><p>${e.message}</p></div>`;
  }
}

function renderInvoiceList(el) {
  let filtered = [...allInvoices];

  if (invoiceFilter.status !== 'all') {
    filtered = filtered.filter(i => i.status === invoiceFilter.status);
  }
  if (invoiceFilter.eventId) {
    filtered = filtered.filter(i => i.eventId === invoiceFilter.eventId);
  }

  const selectedIds = new Set();

  el.innerHTML = `
    <div class="filter-bar">
      <select class="form-input" id="inv-status-filter" style="max-width:160px">
        <option value="all" ${invoiceFilter.status==='all'?'selected':''}>Alle Status</option>
        <option value="draft" ${invoiceFilter.status==='draft'?'selected':''}>Entwürfe</option>
        <option value="committed" ${invoiceFilter.status==='committed'?'selected':''}>In Webling</option>
      </select>
      <select class="form-input" id="inv-event-filter" style="max-width:240px">
        <option value="">Alle Events</option>
        ${allEvents.map(ev => `<option value="${ev.id}" ${ev.id===invoiceFilter.eventId?'selected':''}>${esc(ev.name)}</option>`).join('')}
      </select>
      <input class="form-input" type="text" id="inv-search" placeholder="Name suchen..." style="max-width:200px">
      <button class="btn btn-sm" id="btn-bulk-commit" style="margin-left:auto">✅ Alle Entwürfe buchen</button>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">🧾</div>
        <h3>Keine Rechnungen</h3>
        <p>Lade eine CSV hoch, um Rechnungen zu erstellen.</p>
        <button class="btn btn-primary btn-sm" onclick="navigate('upload')" style="margin-top:0.75rem">CSV hochladen</button>
      </div>
    ` : `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" id="inv-select-all"></th>
              <th>Mitglied</th>
              <th>Event</th>
              <th>Betrag</th>
              <th>Rechnungsdatum</th>
              <th>Status</th>
              <th>Aktionen</th>
            </tr>
          </thead>
          <tbody id="inv-tbody">
            ${filtered.map(inv => `
              <tr data-id="${inv.id}">
                <td><input type="checkbox" class="inv-check" data-id="${inv.id}" ${inv.status==='committed'?'disabled':''}></td>
                <td><strong>${esc(inv.memberName||'—')}</strong><br><span style="font-size:0.75rem;color:var(--text-secondary)">${esc(inv.memberEmail||'')}</span></td>
                <td style="font-size:0.82rem">${esc(inv.eventName||'—')}</td>
                <td>CHF ${(inv.amount||0).toFixed(2)}</td>
                <td style="font-size:0.82rem">${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('de-CH') : '—'}</td>
                <td><span class="badge badge-${inv.status}">${inv.status === 'committed' ? '✅ Gebucht' : '📝 Entwurf'}</span></td>
                <td>
                  <div class="row-actions">
                    ${inv.status === 'draft' ? `<button class="btn btn-sm btn-commit-inv" data-id="${inv.id}" title="In Webling buchen">✅</button>` : ''}
                    <button class="btn btn-sm btn-email-inv" data-id="${inv.id}" title="E-Mail-Vorlage">📧</button>
                    ${inv.status === 'draft' ? `<button class="btn btn-sm btn-delete-inv" data-id="${inv.id}" title="Löschen" style="color:#dc2626">🗑</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.5rem">${filtered.length} Rechnung(en)</div>
    `}
  `;

  // Filter events
  document.getElementById('inv-status-filter').addEventListener('change', (e) => {
    invoiceFilter.status = e.target.value;
    renderInvoiceList(el);
  });
  document.getElementById('inv-event-filter').addEventListener('change', (e) => {
    invoiceFilter.eventId = e.target.value;
    renderInvoiceList(el);
  });
  document.getElementById('inv-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#inv-tbody tr').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = q && !text.includes(q) ? 'none' : '';
    });
  });

  // Select all
  document.getElementById('inv-select-all')?.addEventListener('change', (e) => {
    document.querySelectorAll('.inv-check:not([disabled])').forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
  });
  document.querySelectorAll('.inv-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
  });

  // Bulk commit
  document.getElementById('btn-bulk-commit').addEventListener('click', async () => {
    const ids = filtered.filter(i => i.status === 'draft').map(i => i.id);
    if (!ids.length) { toast('Keine Entwürfe vorhanden', 'info'); return; }
    if (!confirm(`${ids.length} Rechnung(en) in Webling buchen?`)) return;
    await bulkCommit(ids, el);
  });

  // Row actions
  document.getElementById('inv-tbody')?.addEventListener('click', async (e) => {
    const commitBtn = e.target.closest('.btn-commit-inv');
    if (commitBtn) { await commitOne(commitBtn.dataset.id, el); return; }

    const emailBtn = e.target.closest('.btn-email-inv');
    if (emailBtn) { await showEmailModal(emailBtn.dataset.id); return; }

    const deleteBtn = e.target.closest('.btn-delete-inv');
    if (deleteBtn) {
      if (!confirm('Rechnung löschen?')) return;
      try {
        await DEL(`/api/invoices/${deleteBtn.dataset.id}`);
        toast('Rechnung gelöscht');
        loadInvoices();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

async function commitOne(id, containerEl) {
  try {
    await POST(`/api/invoices/${id}/commit`);
    toast('Rechnung in Webling gebucht', 'success');
    loadInvoices();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function bulkCommit(ids, containerEl) {
  const btn = document.getElementById('btn-bulk-commit');
  btn.disabled = true;
  btn.textContent = 'Wird gebucht...';
  try {
    const data = await POST('/api/invoices/bulk/commit', { ids });
    toast(`${data.committed} von ${data.total} gebucht`, data.errors?.length ? 'info' : 'success');
    if (data.errors?.length) {
      console.error('Commit errors:', data.errors);
    }
    loadInvoices();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Alle Entwürfe buchen';
  }
}

async function showEmailModal(id) {
  try {
    const data = await GET(`/api/invoices/${id}/email`);
    document.getElementById('email-preview').textContent = data.emailText || '';
    document.getElementById('modal-email').style.display = 'flex';
  } catch (e) {
    toast(e.message, 'error');
  }
}

document.getElementById('modal-email-close').addEventListener('click', () => { document.getElementById('modal-email').style.display = 'none'; });
document.getElementById('modal-email-close2').addEventListener('click', () => { document.getElementById('modal-email').style.display = 'none'; });
document.getElementById('btn-copy-email').addEventListener('click', () => {
  const text = document.getElementById('email-preview').textContent;
  navigator.clipboard.writeText(text).then(() => toast('E-Mail-Text kopiert'));
});

// ---- Settings ----

async function loadSettings() {
  const el = document.getElementById('settings-content');
  el.innerHTML = '<div class="loading">Wird geladen...</div>';

  try {
    const [settData, perData, accData, catData] = await Promise.all([
      GET('/api/settings'),
      GET('/api/webling/periods').catch(() => ({ periods: [] })),
      GET('/api/webling/accounts').catch(() => ({ accounts: [] })),
      GET('/api/webling/categories').catch(() => ({ categories: [] })),
    ]);

    const s = settData.settings || {};
    const periods = perData.periods || [];
    const accounts = accData.accounts || [];
    const categories = catData.categories || [];

    const opt = (arr, val, empty = '— keine —') =>
      `<option value="">${empty}</option>` +
      arr.map(a => `<option value="${a.id}" ${a.id === val ? 'selected' : ''}>${esc(a.title || a.number || a.id)}</option>`).join('');

    el.innerHTML = `
      <form id="form-settings">
        <div class="settings-section">
          <h2>Webling Buchungs-Vorgaben</h2>
          <div class="card">
            <div class="form-group">
              <label class="form-label">Standard-Buchungsperiode</label>
              <select class="form-input" name="periodId" style="max-width:400px">
                ${opt(periods, s.periodId, '— wählen —')}
              </select>
            </div>
            <div class="form-row" style="max-width:600px">
              <div class="form-group">
                <label class="form-label">Soll-Konto (Debit)</label>
                <select class="form-input" name="debitAccountId">${opt(accounts, s.debitAccountId)}</select>
              </div>
              <div class="form-group">
                <label class="form-label">Haben-Konto (Credit)</label>
                <select class="form-input" name="creditAccountId">${opt(accounts, s.creditAccountId)}</select>
              </div>
            </div>
            <div class="form-group" style="max-width:400px">
              <label class="form-label">Debitorenkategorie</label>
              <select class="form-input" name="debitorcategoryId">${opt(categories, s.debitorcategoryId)}</select>
            </div>
            <div class="form-row" style="max-width:400px">
              <div class="form-group">
                <label class="form-label">Zahlungsziel (Tage)</label>
                <input class="form-input" type="number" name="defaultDueDays" value="${s.defaultDueDays||30}" min="1">
              </div>
              <div class="form-group">
                <label class="form-label">Standard-Rechnungstitel</label>
                <input class="form-input" type="text" name="defaultInvoiceTitle" value="${esc(s.defaultInvoiceTitle||'')}">
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h2>E-Mail &amp; Zahlung</h2>
          <div class="card">
            <div class="form-row" style="max-width:600px">
              <div class="form-group">
                <label class="form-label">Absendername</label>
                <input class="form-input" type="text" name="senderName" value="${esc(s.senderName||'')}">
              </div>
              <div class="form-group">
                <label class="form-label">Absender-E-Mail</label>
                <input class="form-input" type="email" name="senderEmail" value="${esc(s.senderEmail||'')}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Bankverbindung (mehrzeilig)</label>
              <textarea class="form-input" name="bankDetails" rows="3">${esc(s.bankDetails||'')}</textarea>
            </div>
            <div class="form-group" style="max-width:280px">
              <label class="form-label">Twint-Nummer</label>
              <input class="form-input" type="text" name="twintNumber" value="${esc(s.twintNumber||'')}" placeholder="+41 79 000 00 00">
            </div>
          </div>
        </div>

        <button type="submit" class="btn btn-primary">Einstellungen speichern</button>
      </form>
    `;

    document.getElementById('form-settings').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const payload = {};
      form.querySelectorAll('[name]').forEach(input => {
        payload[input.name] = input.type === 'number' ? (Number(input.value) || 0) : input.value;
      });
      try {
        await PUT('/api/settings', payload);
        toast('Einstellungen gespeichert');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

  } catch (e) {
    el.innerHTML = `<div class="empty-state"><h3>Fehler</h3><p>${e.message}</p></div>`;
  }
}

// ---- Upload match resolution ----

/**
 * Called when user picks from a "multiple" or "unmatched with suggestions" dropdown.
 * Updates uploadRows and refreshes the stat counts + button text.
 */
function pickMatch(i, sel, originalStatus) {
  if (sel.value) {
    uploadRows[i].memberId = sel.value;
    uploadRows[i].memberName = sel.options[sel.selectedIndex].text.split(' — ')[0];
    uploadRows[i].matchStatus = 'matched';
    const badge = document.querySelector(`#match-row-${i} .match-badge`);
    if (badge) {
      badge.className = 'badge badge-matched match-badge';
      badge.textContent = '✅ ' + uploadRows[i].memberName;
    }
  } else {
    uploadRows[i].memberId = null;
    uploadRows[i].memberName = null;
    uploadRows[i].matchStatus = originalStatus;
    const badge = document.querySelector(`#match-row-${i} .match-badge`);
    if (badge) {
      badge.className = `badge badge-${originalStatus} match-badge`;
      badge.textContent = originalStatus === 'multiple' ? '⚠️ mehrere' : '❌ kein Treffer';
    }
  }
  updateMatchCounts();
}

function updateMatchCounts() {
  const matchedCount   = uploadRows.filter(r => r.matchStatus === 'matched').length;
  const unmatchedCount = uploadRows.filter(r => r.matchStatus === 'unmatched').length;
  const multipleCount  = uploadRows.filter(r => r.matchStatus === 'multiple').length;
  const sm = document.getElementById('stat-matched');
  const su = document.getElementById('stat-unmatched');
  const sp = document.getElementById('stat-multiple');
  if (sm) sm.textContent = `✅ ${matchedCount} zugeordnet`;
  if (su) su.textContent = `❌ ${unmatchedCount} kein Treffer`;
  if (sp) sp.textContent = `⚠️ ${multipleCount} mehrere Treffer`;
  const btn = document.getElementById('btn-create-invoices');
  if (btn) btn.textContent = `🧾 ${matchedCount} Rechnung(en) erstellen`;
}

// ---- Helpers ----

function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
