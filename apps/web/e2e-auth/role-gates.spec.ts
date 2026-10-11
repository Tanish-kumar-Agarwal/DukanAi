import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

/**
 * Audit 2026-10-11 under real sessions. W12: a page offers only what the API
 * accepts from the signed-in role (the API's role sets; AUTH_DISABLED is the
 * OWNER). W4: a cashier edits a customer without the credit limit the API
 * refuses from anyone below MANAGER. W17: the sign-in forms are labelled and
 * their error is an alert.
 */

const API_URL = `http://localhost:${process.env.E2E_AUTH_API_PORT ?? 3005}/api`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'mysql://root:password@localhost:3306/dukaanai_test';
const PASSWORD = 'Str0ng-Passw0rd!';

// bcrypt is the API's hashing library (hoisted to the workspace root); staff rows are inserted directly.
const require = createRequire(__filename);
const bcrypt = require('bcrypt') as { hash(data: string, rounds: number): Promise<string> };

type Role = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'VIEWER';

interface Shop {
  id: string;
  ownerEmail: string;
  ownerToken: string;
}

function stamp(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function call<T>(request: APIRequestContext, token: string, method: 'get' | 'post' | 'patch', path: string, data?: unknown, expected = method === 'post' ? 201 : 200): Promise<T> {
  const res = await request[method](`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });
  expect(res.status(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBe(expected);
  return (await res.json()) as T;
}

/** A shop registered through the API (the public route the register page posts to). */
async function createShop(request: APIRequestContext): Promise<Shop> {
  const id = stamp();
  const ownerEmail = `gate-owner-${id}@example.com`;
  const res = await request.post(`${API_URL}/auth/register`, { data: { name: 'Gate Owner', shopName: `Gate Shop ${id}`, email: ownerEmail, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(201);
  const ownerToken = await apiToken(request, ownerEmail);
  const shop = await call<{ id: string }>(request, ownerToken, 'get', '/shops/me');
  return { id: shop.id, ownerEmail, ownerToken };
}

async function addStaff(shop: Shop, role: Role, name = `${role[0]}${role.slice(1).toLowerCase()} ${stamp()}`): Promise<{ id: string; email: string; name: string }> {
  const id = `${role.toLowerCase()}-${stamp()}`;
  const email = `${id}@example.com`;
  const conn = await mysql.createConnection(DATABASE_URL);
  try {
    await conn.execute(
      'INSERT INTO User (id, email, password, name, role, shopId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, NOW(3), NOW(3))',
      [id, email, await bcrypt.hash(PASSWORD, 4), name, role, shop.id],
    );
  } finally {
    await conn.end();
  }
  return { id, email, name };
}

/** The Modal component has no dialog role: scope on the panel that carries the title. */
function inviteModal(page: Page) {
  return page.locator('div.rounded-2xl').filter({ has: page.getByRole('heading', { name: 'Invite a Staff Member' }) });
}

async function signIn(page: Page, email: string): Promise<void> {
  // A click before the page has hydrated (the first compile of a fresh dev server) does nothing: try again.
  for (let attempt = 1; ; attempt += 1) {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.locator('form button[type="submit"]').click();
    const landed = await page.waitForURL('**/dashboard', { timeout: 20_000 }).then(() => true, () => false);
    if (landed) return;
    if (attempt === 3) throw new Error(`sign-in as ${email} never reached the dashboard`);
  }
}

/** Waits until the session is read, so role-dependent chrome has settled. */
async function sessionRole(page: Page): Promise<string> {
  let role = '';
  await expect.poll(async () => (role = await page.evaluate(() => fetch('/api/auth/session').then((r) => r.json()).then((s) => (s?.user?.role as string) ?? '')))).not.toBe('');
  return role;
}

/** A sale the owner rang up: a cash invoice of one ₹100 service line. */
async function seedSale(request: APIRequestContext, shop: Shop): Promise<{ invoiceId: string; customerId: string; customerName: string }> {
  const product = await call<{ id: string }>(request, shop.ownerToken, 'post', '/products', {
    name: `Gate item ${stamp()}`, type: 'SERVICE', unit: 'PCS', gstRate: 'ZERO', costPrice: 40, sellingPrice: 100, mrp: 100,
  });
  const customerName = `Gate customer ${stamp()}`;
  const customer = await call<{ id: string }>(request, shop.ownerToken, 'post', '/customers', { name: customerName, phone: String(6_000_000_000 + Math.floor(Math.random() * 999_999_999)), creditLimit: 500 });
  await call(request, shop.ownerToken, 'post', '/shifts/open', { openingCash: 0 });
  const sale = await call<{ invoice: { id: string } }>(request, shop.ownerToken, 'post', '/billing/invoice', {
    idempotencyKey: randomUUID(), items: [{ productId: product.id, quantity: 1 }], customerId: customer.id, payments: [{ tender: 'CASH', amount: 100 }], udharAmount: 0,
  });
  return { invoiceId: sale.invoice.id, customerId: customer.id, customerName };
}

/** A pending expense and a supplier the owner recorded: what a lower role may read but not change. */
async function seedBooks(request: APIRequestContext, shop: Shop): Promise<{ expense: string; supplierId: string; supplierName: string }> {
  const expense = `Gate expense ${stamp()}`;
  await call(request, shop.ownerToken, 'post', '/expenses', { description: expense, category: 'Utilities', amount: 120.5, isPaid: false });
  const supplierName = `Gate supplier ${stamp()}`;
  const supplier = await call<{ id: string }>(request, shop.ownerToken, 'post', '/suppliers', { name: supplierName, phone: String(6_200_000_000 + Math.floor(Math.random() * 99_999_999)) });
  return { expense, supplierId: supplier.id, supplierName };
}

/**
 * Expenses and supplier payments are MANAGEMENT_ROLES on the API: below that, the
 * page offers no "Record Expense", no expense row actions and no "Pay Supplier",
 * and the API refuses both writes.
 */
async function expectNoBookWrites(page: Page, request: APIRequestContext, email: string, books: { expense: string; supplierId: string; supplierName: string }): Promise<void> {
  await page.goto('/expenses');
  await expect(page.getByText(books.expense)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record Expense' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Actions for ${books.expense}` })).toHaveCount(0);

  await page.goto('/suppliers');
  await page.getByRole('button', { name: `Actions for ${books.supplierName}` }).click();
  await expect(page.getByRole('button', { name: 'View Details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay Supplier' })).toHaveCount(0);

  const as = { headers: { Authorization: `Bearer ${await apiToken(request, email)}` } };
  expect((await request.post(`${API_URL}/expenses`, { ...as, data: { description: 'Nope', category: 'Utilities', amount: 1 } })).status()).toBe(403);
  expect((await request.post(`${API_URL}/suppliers/${books.supplierId}/payments`, { ...as, data: { amount: 1, tender: 'CASH', idempotencyKey: randomUUID() } })).status()).toBe(403);
}

test.describe('role gates (audit W12)', () => {
  test('a VIEWER sees no POS, OCR, customer write, return, export or mark-all-read action', async ({ page, request }) => {
    const shop = await createShop(request);
    const { invoiceId, customerId, customerName } = await seedSale(request, shop);
    const books = await seedBooks(request, shop);
    const viewer = await addStaff(shop, 'VIEWER');
    await signIn(page, viewer.email);
    expect(await sessionRole(page)).toBe('VIEWER');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Invoices' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Billing (POS)' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /AI OCR Scanner/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Employees' })).toHaveCount(0);

    // Dashboard quick actions lead only where the role can act.
    await page.goto('/dashboard');
    const quick = page.getByRole('heading', { name: 'Quick Actions' }).locator('..');
    await expect(quick.getByRole('link', { name: 'Invoices' })).toBeVisible();
    for (const label of ['Create Bill', 'Add Product', 'Add Customer']) {
      await expect(quick.getByRole('link', { name: label })).toHaveCount(0);
    }

    await page.goto('/customers');
    await expect(page.getByRole('button', { name: `Actions for ${customerName}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add customer' })).toHaveCount(0);
    await page.getByRole('button', { name: `Actions for ${customerName}` }).click();
    await expect(page.getByRole('menuitem', { name: 'View details' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Record payment' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Edit customer' })).toHaveCount(0);
    await page.goto(`/customers/${customerId}`);
    await expect(page.getByRole('heading', { name: customerName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);

    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return' })).toHaveCount(0);

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);

    await page.goto('/ai-scanner');
    await expect(page.getByText('Only managers, admins and the owner can scan bills.', { exact: false })).toBeVisible();
    await expect(page.getByTestId('scan-input')).toBeDisabled();

    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expect(page.getByRole('menu').getByRole('heading', { name: /Notifications/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);

    // The API refuses every hidden action from this role anyway.
    const viewerToken = await apiToken(request, viewer.email);
    const as = { headers: { Authorization: `Bearer ${viewerToken}` } };
    expect((await request.patch(`${API_URL}/customers/${customerId}`, { ...as, data: { name: 'Nope' } })).status()).toBe(403);
    expect((await request.post(`${API_URL}/billing/returns`, { ...as, data: { idempotencyKey: randomUUID(), invoiceId } })).status()).toBe(403);
    expect((await request.get(`${API_URL}/dashboard/export/invoices.csv?from=2026-01-01&to=2026-01-02`, as)).status()).toBe(403);
    expect((await request.patch(`${API_URL}/notifications/read-all`, as)).status()).toBe(403);
    expect((await request.get(`${API_URL}/users/employees`, as)).status()).toBe(403);
    // Smart Capture's saves (disabled for this role) go to a POS_ROLES route.
    expect((await request.post(`${API_URL}/storage/bills/Walk-in/${randomUUID()}`, as)).status()).toBe(403);

    await expectNoBookWrites(page, request, viewer.email, books);
  });

  test('a CASHIER edits a customer with the credit limit read-only (W4) and has no OCR or export', async ({ page, request }) => {
    const shop = await createShop(request);
    const { customerId, customerName } = await seedSale(request, shop);
    const books = await seedBooks(request, shop);
    const cashier = await addStaff(shop, 'CASHIER');
    await signIn(page, cashier.email);
    expect(await sessionRole(page)).toBe('CASHIER');

    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Billing (POS)' })).toBeVisible();
    await expect(nav.getByRole('link', { name: /AI OCR Scanner/ })).toHaveCount(0);

    await page.goto(`/customers/${customerId}`);
    await expect(page.getByRole('heading', { name: customerName })).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const limit = page.getByLabel('Credit limit (₹)');
    await expect(limit).toBeDisabled();
    await expect(limit).toHaveValue('500');
    await page.getByLabel('City').fill('Mysuru');
    const patch = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/customers/${customerId}`));
    await page.getByRole('button', { name: 'Save changes' }).click();
    const response = await patch;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().postDataJSON()).not.toHaveProperty('creditLimit');
    await expect(page.getByText('Customer updated')).toBeVisible();

    await page.reload();
    await expect(page.getByText('Mysuru', { exact: false }).first()).toBeVisible();
    const stored = await call<{ city: string; creditLimit: string | number }>(request, shop.ownerToken, 'get', `/customers/${customerId}`);
    expect(stored.city).toBe('Mysuru');
    expect(Number(stored.creditLimit)).toBe(500);

    // A new customer from a cashier carries no credit limit either.
    await page.goto('/customers');
    await page.getByRole('button', { name: 'Add customer' }).first().click();
    await expect(page.getByLabel('Credit limit (₹)')).toBeDisabled();
    await expect(page.getByLabel('Credit limit (₹)')).toHaveAttribute('placeholder', 'Set by a manager');
    await page.getByLabel('Name *').fill(`Cashier walk-in ${stamp()}`);
    await page.getByLabel('Phone *').fill(String(6_100_000_000 + Math.floor(Math.random() * 99_999_999)));
    const post = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/customers'));
    await page.getByRole('button', { name: 'Save customer' }).click();
    const created = await post;
    expect(created.status(), await created.text()).toBe(201);
    expect(created.request().postDataJSON()).not.toHaveProperty('creditLimit');

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(0);
    await page.goto('/ai-scanner');
    await expect(page.getByTestId('scan-input')).toBeDisabled();

    await expectNoBookWrites(page, request, cashier.email, books);
  });

  test('invitations offer only lower roles; suspend and remove only lower-ranked users', async ({ page, request }) => {
    const shop = await createShop(request);
    const admin = await addStaff(shop, 'ADMIN');
    const peer = await addStaff(shop, 'ADMIN', `Peer admin ${stamp()}`);
    const cashier = await addStaff(shop, 'CASHIER', `Ranked cashier ${stamp()}`);
    const manager = await addStaff(shop, 'MANAGER');

    await signIn(page, admin.email);
    expect(await sessionRole(page)).toBe('ADMIN');
    await page.goto('/employees');
    await page.getByRole('button', { name: 'Invite Employee' }).click();
    await expect(page.getByRole('heading', { name: 'Invite a Staff Member' })).toBeVisible();
    await expect(inviteModal(page).locator('select option')).toHaveText(['Cashier', 'Stock Clerk', 'Manager']);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.getByRole('button', { name: `Actions for ${cashier.name}` }).click();
    await expect(page.getByRole('button', { name: 'Suspend Access' })).toBeVisible();
    // Another admin ranks the same: the menu says why it offers nothing.
    await page.getByRole('button', { name: `Actions for ${peer.name}` }).click();
    await expect(page.getByText('You can only suspend or remove a role below your own.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspend Access' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove from Shop' })).toHaveCount(0);
    const adminToken = await apiToken(request, admin.email);
    expect((await request.patch(`${API_URL}/users/${peer.id}/suspend`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { isActive: false } })).status()).toBe(403);

    // A MANAGER invites cashiers and viewers only; it never suspends anyone (OWNER / ADMIN routes).
    await page.context().clearCookies();
    await signIn(page, manager.email);
    expect(await sessionRole(page)).toBe('MANAGER');
    await page.goto('/employees');
    await page.getByRole('button', { name: 'Invite Employee' }).click();
    await expect(inviteModal(page).locator('select option')).toHaveText(['Cashier', 'Stock Clerk']);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: `Actions for ${cashier.name}` }).click();
    await expect(page.getByRole('button', { name: 'View Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Suspend Access' })).toHaveCount(0);
  });
});

test.describe('labelled sign-in forms (audit W17)', () => {
  test('login and register fields are reachable by their labels and the login error is an alert', async ({ page, request }) => {
    const shop = await createShop(request);
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(shop.ownerEmail);
    await page.getByLabel('Password').fill('not-the-password');
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();

    await page.goto('/register');
    for (const label of ['Full Name', 'Shop Name', 'Email Address', 'Password']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByLabel('Invitation code')).toBeVisible();
  });
});
