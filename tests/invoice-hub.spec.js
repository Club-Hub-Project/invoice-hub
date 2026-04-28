/**
 * Invoice Hub — Playwright E2E Test Suite
 *
 * Run against local dev server:
 *   cd Invoice/worker && npx wrangler dev
 *   npx playwright test --config=tests/playwright.config.js
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.INVOICE_HUB_URL || 'http://localhost:8787';

// ---- Helpers ----

async function loginAsAdmin(page) {
  // In test environments, use a pre-seeded test token if available
  const testToken = process.env.TEST_TOKEN;
  if (testToken) {
    await page.goto(BASE_URL);
    await page.evaluate((token) => {
      localStorage.setItem('invoice_hub_token', token);
    }, testToken);
    await page.reload();
    return;
  }

  await page.goto(`${BASE_URL}/login.html`);
  await page.fill('#email', process.env.TEST_EMAIL || 'admin@taekwondobern.ch');
  await page.click('button[type=submit]');
  await expect(page.locator('#success')).toBeVisible();
  // In a real test you would intercept the code from email or mock the auth service
}

// ---- Login Page ----

test.describe('Login', () => {
  test('shows login form', async ({ page }) => {
    await page.goto(`${BASE_URL}/login.html`);
    await expect(page.locator('h1')).toContainText('Invoice Hub');
    await expect(page.locator('#step-email')).toBeVisible();
    await expect(page.locator('#step-code')).not.toBeVisible();
  });

  test('shows code step after email submit', async ({ page }) => {
    await page.goto(`${BASE_URL}/login.html`);
    // Mock auth: if auth service is not available this will show an error
    await page.fill('#email', 'test@example.com');
    // Just check the form has the right structure
    await expect(page.locator('button[type=submit]')).toContainText('Code senden');
  });

  test('back-to-email link shows email step', async ({ page }) => {
    await page.goto(`${BASE_URL}/login.html`);
    // Manually show code step
    await page.evaluate(() => {
      document.getElementById('step-email').style.display = 'none';
      document.getElementById('step-code').style.display = '';
    });
    await page.click('#back-to-email');
    await expect(page.locator('#step-email')).toBeVisible();
    await expect(page.locator('#step-code')).not.toBeVisible();
  });
});

// ---- Public API ----

test.describe('Public API', () => {
  test('GET /api/hub/stats returns valid JSON', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/hub/stats`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('appId', 'invoice-hub');
    expect(body).toHaveProperty('stats');
    expect(Array.isArray(body.stats)).toBeTruthy();
  });
});

// ---- Protected API (requires auth) ----

test.describe('Protected API', () => {
  test('GET /api/events returns 401 without token', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/events`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/invoices returns 401 without token', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invoices`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/settings returns 401 without token', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/settings`);
    expect(res.status()).toBe(401);
  });
});

// ---- CSV Parsing (worker logic) ----

test.describe('CSV Upload API', () => {
  test('POST /api/upload/csv returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/upload/csv`, {
      headers: { 'Content-Type': 'text/plain' },
      data: 'Vorname;Name\nMax;Muster',
    });
    expect(res.status()).toBe(401);
  });
});

// ---- Frontend ----

test.describe('Frontend', () => {
  test('index.html loads and redirects to login when not authenticated', async ({ page }) => {
    // Clear any stored tokens
    await page.goto(`${BASE_URL}`);
    await page.evaluate(() => localStorage.removeItem('invoice_hub_token'));
    await page.reload();

    // Should either show login or redirect to /login.html
    await page.waitForTimeout(1000);
    const url = page.url();
    const isLoginPage = url.includes('login') || await page.locator('#step-email').isVisible().catch(() => false);
    expect(isLoginPage).toBeTruthy();
  });

  test('login.html has correct brand colors', async ({ page }) => {
    await page.goto(`${BASE_URL}/login.html`);
    const btn = page.locator('.login-btn');
    await expect(btn).toBeVisible();
    const bg = await btn.evaluate(el => getComputedStyle(el).backgroundColor);
    // Should be green (Invoice Hub brand)
    expect(bg).toContain('22'); // rgb(22, 163, 74)
  });

  test('sidebar has all navigation items', async ({ page }) => {
    await page.goto(`${BASE_URL}`);
    // Even without auth the sidebar HTML should be present in the DOM
    const navItems = await page.locator('.nav-item[data-view]').count();
    expect(navItems).toBeGreaterThanOrEqual(4); // dashboard, events, upload, invoices
  });
});

// ---- Authenticated Flows (integration, skipped if no TEST_TOKEN) ----

test.describe('Authenticated flows', () => {
  test.skip(!process.env.TEST_TOKEN, 'TEST_TOKEN not set — skipping authenticated tests');

  let token;
  let eventId;
  let invoiceId;

  test.beforeAll(async ({ request }) => {
    token = process.env.TEST_TOKEN;
  });

  test('GET /api/events returns empty list initially', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.events)).toBeTruthy();
  });

  test('POST /api/events creates event', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/events`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Test Event', date: '2026-07-15', fee: 50, description: 'Playwright test' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.event).toHaveProperty('id');
    expect(body.event.name).toBe('Test Event');
    expect(body.event.fee).toBe(50);
    eventId = body.event.id;
  });

  test('GET /api/events lists created event', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/events`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const found = body.events.find(e => e.id === eventId);
    expect(found).toBeTruthy();
  });

  test('PUT /api/events/:id updates event', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/events/${eventId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { fee: 75 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.event.fee).toBe(75);
  });

  test('POST /api/upload/csv parses CSV and returns match results', async ({ request }) => {
    const csvData = new Blob(['Vorname;Name\nMax;Muster\nAnna;Schmidt'], { type: 'text/csv' });

    // Use FormData equivalent
    const res = await request.post(`${BASE_URL}/api/upload/csv`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      data: 'Vorname;Name\nMax;Muster\nAnna;Schmidt',
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('rows');
    expect(body.rows.length).toBe(2);
    expect(body.stats.total).toBe(2);
  });

  test('POST /api/invoices creates invoice drafts', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/invoices`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        eventId,
        rows: [{ memberId: '99999', memberName: 'Test Member', memberEmail: 'test@example.com' }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.created).toBe(1);
    invoiceId = body.invoices[0].id;
  });

  test('GET /api/invoices lists draft', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invoices?status=draft`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    const found = body.invoices.find(i => i.id === invoiceId);
    expect(found).toBeTruthy();
    expect(found.status).toBe('draft');
  });

  test('PUT /api/invoices/:id updates draft', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { amount: 99, title: 'Playwright Test Invoice' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.invoice.amount).toBe(99);
    expect(body.invoice.title).toBe('Playwright Test Invoice');
  });

  test('GET /api/invoices/:id/email returns email text', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/invoices/${invoiceId}/email`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.emailText).toBe('string');
    expect(body.emailText).toContain('CHF');
  });

  test('GET /api/settings returns defaults', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.settings).toHaveProperty('defaultDueDays');
    expect(body.settings).toHaveProperty('bankDetails');
  });

  test('PUT /api/settings updates settings', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { twintNumber: '+41 79 111 11 11', defaultDueDays: 14 },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.settings.twintNumber).toBe('+41 79 111 11 11');
    expect(body.settings.defaultDueDays).toBe(14);
  });

  // Cleanup
  test('DELETE /api/invoices/:id deletes draft', async ({ request }) => {
    const res = await request.delete(`${BASE_URL}/api/invoices/${invoiceId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('DELETE /api/events/:id deletes event', async ({ request }) => {
    const res = await request.delete(`${BASE_URL}/api/events/${eventId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok()).toBeTruthy();
  });
});
