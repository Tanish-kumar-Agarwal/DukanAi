import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';
import { createRequire } from 'node:module';

/**
 * Roadmap 6.9: the real sign-in flow (no bypass), every repaired page under a
 * real session, and role gating: a VIEWER sees no write buttons and the API
 * refuses the same writes anyway.
 */

const API_URL = `http://localhost:${process.env.E2E_AUTH_API_PORT ?? 3005}/api`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'mysql://root:password@localhost:3306/dukaanai_test';
const PASSWORD = 'Str0ng-Passw0rd!';

// bcrypt is the API's hashing library (hoisted to the workspace root); the VIEWER row is inserted directly.
const require = createRequire(__filename);
const bcrypt = require('bcrypt') as { hash(data: string, rounds: number): Promise<string> };

interface Owner {
  email: string;
  shopName: string;
}

function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function registerOwner(page: Page): Promise<Owner> {
  const id = stamp();
  const owner = { email: `owner-${id}@example.com`, shopName: `Real Auth Shop ${id}` };
  await page.goto('/register');
  await page.getByPlaceholder('Rajesh Kumar').fill('Real Owner');
  await page.getByPlaceholder('Kumar General Store').fill(owner.shopName);
  await page.getByPlaceholder('rajesh@example.com').fill(owner.email);
  await page.getByPlaceholder('Min. 8 characters').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Store' }).click();
  await page.waitForURL('**/dashboard');
  return owner;
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('admin@dukaan.ai').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function signOut(page: Page): Promise<void> {
  await page.getByTitle('Sign out').click();
  await page.waitForURL('**/login**');
}

async function apiToken(request: APIRequestContext, email: string, password: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { access_token: string }).access_token;
}

test.describe('real sign-in (6.9)', () => {
  test('a visitor is bounced to /login with a callback; a wrong password is refused; the right one lands on the callback', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL('**/login?callbackUrl=%2Fdashboard');
    const response = await page.goto('/products');
    expect(response?.url()).toContain('/login?callbackUrl=%2Fproducts');

    const owner = await registerOwner(page);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await signOut(page);

    await page.goto('/products');
    await page.waitForURL('**/login?callbackUrl=%2Fproducts');
    await page.getByPlaceholder('admin@dukaan.ai').fill(owner.email);
    await page.getByPlaceholder('••••••••').fill('wrong-password');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByText('Invalid email or password', { exact: false })).toBeVisible();
    expect(page.url()).toContain('/login');

    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL('**/products');
    await expect(page.getByRole('heading', { name: 'Products & Stock' })).toBeVisible();
  });

  test('every repaired page renders under a real session', async ({ page }) => {
    await registerOwner(page);
    const pages: Array<[string, string]> = [
      ['/products', 'Products & Stock'],
      ['/settings', 'Settings'],
      ['/employees', 'Staff'],
      ['/suppliers', 'Suppliers & Vendors'],
      ['/smart-capture', 'Smart Bill Capture'],
      ['/ai-scanner', 'AI'],
      ['/customers', 'Customers'],
      ['/inventory', 'Inventory Operations'],
      ['/expenses', 'Expenses'],
      ['/invoices', 'Invoices'],
      ['/billing', 'Point of Sale'],
      ['/notifications', 'Notifications'],
      ['/shifts', 'Shift'],
      ['/analytics', 'Reports'],
    ];
    for (const [route, heading] of pages) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
      expect(new URL(page.url()).pathname, route).toBe(route);
      await expect(page.getByTestId('route-error'), route).toHaveCount(0);
      await expect(page.locator('h1').first(), route).toContainText(heading, { ignoreCase: true });
    }
  });

  test('a VIEWER sees no write buttons and the API refuses the same writes', async ({ page, request }) => {
    const owner = await registerOwner(page);
    const ownerToken = await apiToken(request, owner.email, PASSWORD);
    const shop = (await (await request.get(`${API_URL}/shops/me`, { headers: { Authorization: `Bearer ${ownerToken}` } })).json()) as { id: string };

    const viewerEmail = `viewer-${stamp()}@example.com`;
    const hash = await bcrypt.hash(PASSWORD, 4);
    const conn = await mysql.createConnection(DATABASE_URL);
    try {
      await conn.execute(
        'INSERT INTO User (id, email, password, name, role, shopId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(3), NOW(3))',
        [`viewer-${stamp()}`, viewerEmail, hash, 'Read Only', 'VIEWER', shop.id],
      );
    } finally {
      await conn.end();
    }

    await signOut(page);
    await signIn(page, viewerEmail, PASSWORD);
    await page.waitForURL('**/dashboard');

    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'Products & Stock' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Product' })).toHaveCount(0);
    await page.goto('/employees');
    await expect(page.getByRole('button', { name: 'Invite Employee' })).toHaveCount(0);
    await page.goto('/suppliers');
    await expect(page.getByRole('heading', { name: 'Suppliers & Vendors' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Supplier' })).toHaveCount(0);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Shop Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();

    const viewerToken = await apiToken(request, viewerEmail, PASSWORD);
    const as = { headers: { Authorization: `Bearer ${viewerToken}` } };
    expect((await request.post(`${API_URL}/products`, { ...as, data: { name: 'Nope', costPrice: 1, sellingPrice: 2, mrp: 2, wholesalePrice: 2, unit: 'PCS' } })).status()).toBe(403);
    expect((await request.patch(`${API_URL}/shops/me`, { ...as, data: { name: 'Nope' } })).status()).toBe(403);
    expect((await request.post(`${API_URL}/invitations/generate`, { ...as, data: { email: 'x@example.com', role: 'CASHIER' } })).status()).toBe(403);
    expect((await request.post(`${API_URL}/suppliers`, { ...as, data: { name: 'Nope', phone: '9999999999' } })).status()).toBe(403);
    // Reads stay open to every signed-in role.
    expect((await request.get(`${API_URL}/products`, as)).status()).toBe(200);
  });
});
