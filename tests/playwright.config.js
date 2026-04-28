import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './',
  timeout: 30000,
  use: {
    baseURL: process.env.INVOICE_HUB_URL || 'http://localhost:8787',
    headless: true,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
