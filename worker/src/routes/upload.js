/**
 * CSV Upload — parse, match members via USER_CONNECTOR, return match results
 */
import { searchMembers } from '../adapters/webling.js';

function ok(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Parse CSV text into array of row objects.
 * Supports semicolon (Swiss Excel) and comma separators.
 * Handles basic quoted fields.
 */
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect separator
  const firstLine = lines[0];
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';

  function splitLine(line) {
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cols.push(current.trim());
    return cols;
  }

  const headers = splitLine(firstLine);

  return lines.slice(1).map(line => {
    const cols = splitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    return row;
  }).filter(row => Object.values(row).some(v => v)); // skip empty rows
}

/**
 * Normalise a CSV row into a standard member name candidate.
 * Accepts columns: Vorname/FirstName/Firstname, Name/LastName/Lastname,
 * Vollständiger Name/Full Name, or a first unnamed column.
 */
function extractName(row) {
  const keys = Object.keys(row);
  const get = (...names) => {
    for (const n of names) {
      const key = keys.find(k => k.toLowerCase() === n.toLowerCase());
      if (key && row[key]) return row[key].trim();
    }
    return '';
  };

  const vorname = get('Vorname', 'FirstName', 'Firstname', 'First Name', 'Prenom');
  const name = get('Name', 'LastName', 'Lastname', 'Last Name', 'Nom');
  const full = get('Vollständiger Name', 'Full Name', 'Fullname', 'Name complet');

  if (full) return full;
  if (vorname && name) return `${vorname} ${name}`;
  if (vorname) return vorname;
  if (name) return name;
  // Fallback: first non-empty column value
  return row[keys[0]] || '';
}

function extractEmail(row) {
  const keys = Object.keys(row);
  const key = keys.find(k => /e.?mail/i.test(k));
  return key ? row[key].trim() : '';
}

function extractAmount(row) {
  const keys = Object.keys(row);
  const key = keys.find(k => /^(betrag|amount|fee|preis|price)$/i.test(k));
  if (!key) return null;
  const v = parseFloat((row[key] || '').replace(/[^0-9.,]/g, '').replace(',', '.'));
  return isNaN(v) ? null : v;
}

function extractArticle(row) {
  const keys = Object.keys(row);
  const key = keys.find(k => /^(artikel|article|position|leistung|beschreibung|description|item)$/i.test(k));
  return key ? row[key].trim() : '';
}

export async function handleUpload(path, method, request, env) {
  // POST /api/upload/csv — parse CSV and match members
  if (path === '/api/upload/csv' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';

    let csvText;
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file');
      if (!file) return ok({ error: 'No file in form data' }, 400);
      csvText = await file.text();
    } else {
      // Plain text CSV body
      csvText = await request.text();
    }

    if (!csvText.trim()) return ok({ error: 'Empty CSV' }, 400);

    const rows = parseCSV(csvText);
    if (!rows.length) return ok({ error: 'No data rows found in CSV' }, 400);

    // Detect whether any row has a per-row amount (drives UI hint)
    const hasAmountColumn = rows.some(r => extractAmount(r) !== null);
    const hasArticleColumn = rows.some(r => extractArticle(r) !== '');

    // Match each row to a Webling member
    const results = await Promise.all(rows.map(async (row) => {
      const name = extractName(row);
      const email = extractEmail(row);
      const customAmount = extractAmount(row);
      const itemTitle = extractArticle(row);

      if (!name && !email) {
        return { raw: row, name: '', email: '', matchStatus: 'unmatched', matches: [] };
      }

      // searchMembers returns: exact Vorname+Name hits AND Name-only fallback
      // candidates in a single call. We split them here.
      let found = [];
      try {
        if (name) found = await searchMembers(env, name);
        if (!found.length && email) found = await searchMembers(env, email);
      } catch { /* connector unavailable */ }

      // A result is an "exact match" when EVERY query word appears in the
      // member's display name — this tolerates compound first names like
      // "Elena Sophie" matching the CSV query "Elena Wenger" (both "elena"
      // and "wenger" are present in "Elena Sophie Wenger").
      const queryParts = (name || email).toLowerCase().split(/\s+/).filter(Boolean);
      const exactMatches = found.filter(m => {
        const t = (m.displayName || '').toLowerCase();
        return queryParts.every(p => t.includes(p));
      });
      // Everything else becomes a candidate shown in the suggestion dropdown
      const exactIds = new Set(exactMatches.map(m => m.id));
      const candidateMatches = found.filter(m => !exactIds.has(m.id));

      const matchStatus = exactMatches.length === 0 ? 'unmatched'
        : exactMatches.length === 1 ? 'matched'
        : 'multiple';

      const selectedMember = exactMatches.length === 1 ? exactMatches[0] : null;

      return {
        raw: row,
        name: name || email,
        email,
        customAmount,
        itemTitle,
        matchStatus,
        matches: exactMatches.slice(0, 5),       // used by 'multiple' dropdown
        suggestions: candidateMatches.slice(0, 5), // used by 'unmatched' dropdown
        memberId: selectedMember?.id || null,
        memberName: selectedMember?.displayName || null,
        memberEmail: selectedMember?.email || null,
      };
    }));

    const stats = {
      total: results.length,
      matched: results.filter(r => r.matchStatus === 'matched').length,
      multiple: results.filter(r => r.matchStatus === 'multiple').length,
      unmatched: results.filter(r => r.matchStatus === 'unmatched').length,
      hasAmountColumn,
      hasArticleColumn,
    };

    return ok({ rows: results, stats });
  }

  return null;
}
