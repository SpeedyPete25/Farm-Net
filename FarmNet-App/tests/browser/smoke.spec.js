const path = require('path');
const sqlite3 = require('sqlite3');
const { test, expect } = require('@playwright/test');

const browserDataDir = path.join(__dirname, '..', '..', '.test-data', 'browser');
const browserDbFile = path.join(browserDataDir, 'lab-booking.db');

function uniqueEmail(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(browserDbFile);
    db.run(sql, params, function onRun(error) {
      db.close(() => {
        if (error) {
          reject(error);
          return;
        }
        resolve(this);
      });
    });
  });
}

test('loads the signed-out shell', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'FarmNet Room & Equipment Booking' })).toBeVisible();
  await expect(page.locator('#auth-section')).toBeVisible();
  await expect(page.locator('#dashboard-section')).toHaveClass(/hidden/);
  await expect(page.locator('.tab-button[data-tab="login"]')).toBeVisible();
  await expect(page.locator('.tab-button[data-tab="register"]')).toBeVisible();
  await expect(page.locator('#login-form button[type="submit"]')).toBeVisible();
});

test('supports browser-level register, login, navigation, and logout smoke flow', async ({ page }) => {
  const email = uniqueEmail('browser-user');
  const password = 'Password123';

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.locator('#register-form input[name="email"]').fill(email);
  await page.locator('#register-form input[name="password"]').fill(password);
  await page.locator('#register-form button[type="submit"]').click();

  await expect(page.locator('#login.tab-panel.active')).toBeVisible();

  await page.locator('#login-form input[name="email"]').fill(email);
  await page.locator('#login-form input[name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#dashboard-section')).toBeVisible();
  await expect(page.locator('#auth-section')).toHaveClass(/hidden/);
  await expect(page.locator('#user-status')).toContainText(email);
  await expect(page.locator('#page-dashboard')).toBeVisible();

  await page.locator('#nav-rooms').click();
  await expect(page.locator('#page-rooms')).toBeVisible();
  await expect(page.locator('#timetable-room-select')).toBeVisible();

  await page.locator('#nav-equipment').click();
  await expect(page.locator('#page-equipment')).toBeVisible();
  await expect(page.locator('#equipment-list')).toBeVisible();

  await page.locator('#nav-settings').click();
  await expect(page.locator('#page-settings')).toBeVisible();
  await expect(page.locator('#change-password-form')).toBeVisible();

  await page.locator('#logout-button').click();
  await expect(page.locator('#auth-section')).toBeVisible();
  await expect(page.locator('#dashboard-section')).toHaveClass(/hidden/);
});

test('shows admin-only navigation for an admin account', async ({ page }) => {
  const email = uniqueEmail('browser-admin');
  const password = 'Password123';

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.locator('#register-form input[name="email"]').fill(email);
  await page.locator('#register-form input[name="password"]').fill(password);
  await page.locator('#register-form button[type="submit"]').click();

  await expect(page.locator('#login.tab-panel.active')).toBeVisible();
  await runSql('UPDATE users SET role = ? WHERE email = ?', ['admin', email]);

  await page.locator('#login-form input[name="email"]').fill(email);
  await page.locator('#login-form input[name="password"]').fill(password);
  await page.locator('#login-form button[type="submit"]').click();

  await expect(page.locator('#user-status')).toContainText('(admin)');
  await expect(page.locator('#nav-admin')).toBeVisible();
  await expect(page.locator('#nav-room-management')).toBeVisible();
  await expect(page.locator('#nav-equipment-management')).toBeVisible();

  await page.locator('#nav-admin').click();
  await expect(page.locator('#page-admin')).toBeVisible();
});