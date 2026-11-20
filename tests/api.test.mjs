import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { businessDay, createSale, getSale } from '../server/sales.mjs';

async function fixture(t, options = {}) {
  const db = openDatabase(':memory:');
  const server = createApp(db, options).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, request, base };
}
const order = (overrides = {}) => ({
  requestId: randomUUID(),
  items: [
    { productId: 3, quantity: 2, expectedPriceCents: 1500 },
    { productId: 7, quantity: 1, expectedPriceCents: 1100 },
  ],
  discountPercent: 10,
  paymentMethod: 'cash',
  cashReceivedCents: 5000,
  orderType: 'dine_in',
  tableNumber: 3,
  note: 'Bez cukru',
  ...overrides,
});

test('health checks storage and seeded menu', async (t) => {
  const { request } = await fixture(t);
  assert.deepEqual((await request('/health')).body, {
    status: 'ok',
    storage: 'sqlite',
    currency: 'PLN',
  });
  const products = (await request('/products')).body;
  assert.equal(products.length, 15);
  assert.equal(products.find((p) => p.id === 3).priceCents, 1500);
  assert.deepEqual((await request('/summary')).body, {
    day: businessDay(),
    revenueCents: 0,
    orders: 0,
    averageCents: 0,
  });
});

test('desktop API rejects local requests without its per-process access token', async (t) => {
  const token = randomUUID();
  const { request } = await fixture(t, { accessToken: token });
  assert.equal((await request('/products')).status, 401);
  assert.equal((await request('/sales', 'POST', order())).status, 401);
  assert.equal(
    (await request('/health', 'GET', undefined, { Authorization: 'Bearer invalid' })).status,
    401,
  );
  assert.equal(
    (await request('/health', 'GET', undefined, { Authorization: `Bearer ${token}` })).status,
    200,
  );
  assert.equal(
    (await request('/sales', 'POST', order(), { Authorization: `Bearer ${token}` })).status,
    201,
  );
});

test('cash sale calculates discount, included VAT, change, stock and history', async (t) => {
  const { request } = await fixture(t);
  const { status, body: sale } = await request('/sales', 'POST', order());
  assert.equal(status, 201);
  assert.equal(sale.subtotalCents, 4100);
  assert.equal(sale.discountCents, 410);
  assert.equal(sale.totalCents, 3690);
  assert.equal(sale.vatCents, 552);
  assert.equal(sale.changeCents, 1310);
  assert.equal(sale.tableNumber, 3);
  assert.equal(sale.note, 'Bez cukru');
  assert.deepEqual(
    sale.items.map((i) => [i.totalCents, i.vatCents]),
    [
      [2700, 505],
      [990, 47],
    ],
  );
  assert.equal((await request('/products')).body.find((p) => p.id === 3).stock, 48);
  assert.equal((await request('/products/3/movements')).body[0].quantity, -2);
  assert.equal((await request('/summary')).body.revenueCents, 3690);
  assert.equal((await request('/summary')).body.orders, 1);
  assert.equal((await request('/sales')).body[0].id, sale.id);
});

test('concurrent replay is idempotent and changed payload with the same key is rejected', async (t) => {
  const { request, db } = await fixture(t);
  const payload = order();
  const results = await Promise.all([
    request('/sales', 'POST', payload),
    request('/sales', 'POST', payload),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 3').get().stock, 48);
  assert.equal(
    (await request('/sales', 'POST', { ...payload, note: 'Inne zamówienie' })).status,
    409,
  );
});

test('insufficient stock rolls back the entire sale and inventory', async (t) => {
  const { request, db } = await fixture(t);
  const input = order({
    items: [
      { productId: 1, quantity: 1, expectedPriceCents: 900 },
      { productId: 7, quantity: 19, expectedPriceCents: 1100 },
    ],
  });
  const response = await request('/sales', 'POST', input);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Za mało/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, 80);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE sale_id IS NOT NULL').get().n,
    0,
  );
});

test('simultaneous requests cannot sell the last portion twice', async (t) => {
  const { request, db } = await fixture(t);
  db.prepare('UPDATE products SET stock = 1 WHERE id = 3').run();
  const payload = order({ items: [{ productId: 3, quantity: 1, expectedPriceCents: 1500 }] });
  const results = await Promise.all([
    request('/sales', 'POST', payload),
    request('/sales', 'POST', { ...payload, requestId: randomUUID() }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 3').get().stock, 0);
});

test('underpayment, stale prices and invalid quantities are rejected without stock changes', async (t) => {
  const { request, db } = await fixture(t);
  assert.equal((await request('/sales', 'POST', order({ cashReceivedCents: 100 }))).status, 422);
  assert.equal(
    (
      await request(
        '/sales',
        'POST',
        order({ items: [{ productId: 3, quantity: 1, expectedPriceCents: 1 }] }),
      )
    ).status,
    409,
  );
  for (const quantity of [0, -1, 1.5, 1000, '2']) {
    assert.equal(
      (
        await request(
          '/sales',
          'POST',
          order({ items: [{ productId: 3, quantity, expectedPriceCents: 1500 }] }),
        )
      ).status,
      400,
    );
  }
  assert.equal((await request('/sales', 'POST', order({ items: [] }))).status, 400);
  const duplicate = { productId: 3, quantity: 1, expectedPriceCents: 1500 };
  assert.equal(
    (await request('/sales', 'POST', order({ items: [duplicate, duplicate] }))).status,
    400,
  );
  assert.equal((await request('/sales', 'POST', order({ discountPercent: 101 }))).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 3').get().stock, 50);
});

test('void restores stock once, preserves receipt and removes sale from daily totals', async (t) => {
  const { request } = await fixture(t);
  const sale = (await request('/sales', 'POST', order())).body;
  for (let i = 0; i < 2; i++) {
    const response = await request(`/sales/${sale.id}/void`, 'POST', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'voided');
    assert.ok(response.body.voidedAt);
  }
  assert.equal((await request('/products')).body.find((p) => p.id === 3).stock, 50);
  assert.equal((await request('/summary')).body.orders, 0);
  assert.equal((await request('/summary')).body.revenueCents, 0);
  assert.equal((await request('/sales')).body.length, 1);
});

test('product changes do not rewrite past sale snapshots; stock edits retain a ledger', async (t) => {
  const { request } = await fixture(t);
  const sale = (await request('/sales', 'POST', order())).body;
  assert.equal(
    (
      await request('/products/3', 'PUT', {
        name: 'Cappuccino duże',
        category: 'Kawa',
        priceCents: 2000,
        vatRate: 8,
      })
    ).status,
    200,
  );
  const original = (await request(`/sales/${sale.id}`)).body;
  assert.equal(original.items[0].name, 'Cappuccino');
  assert.equal(original.items[0].unitPriceCents, 1500);
  assert.equal(original.items[0].vatRate, 23);
  const created = await request('/products', 'POST', {
    name: 'Ciastko testowe',
    category: 'Wypieki',
    priceCents: 501,
    vatRate: 5,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.stock, 0);
  const id = created.body.id;
  assert.equal(
    (await request(`/products/${id}/stock`, 'POST', { quantity: 10, reason: 'Dostawa' })).body
      .stock,
    10,
  );
  assert.equal(
    (await request(`/products/${id}/stock`, 'POST', { quantity: -11, reason: 'Strata' })).status,
    422,
  );
  assert.equal(
    (await request(`/products/${id}/stock`, 'POST', { quantity: 0, reason: 'Dostawa' })).status,
    400,
  );
  assert.equal((await request(`/products/${id}/movements`)).body.length, 1);
});

test('rounding preserves every cent for mixed rates, including a 100% discount', async (t) => {
  const { request, db } = await fixture(t);
  db.prepare('UPDATE products SET price_cents = 101 WHERE id = 1').run();
  db.prepare('UPDATE products SET price_cents = 102 WHERE id = 7').run();
  const items = [
    { productId: 1, quantity: 1, expectedPriceCents: 101 },
    { productId: 7, quantity: 1, expectedPriceCents: 102 },
  ];
  const sale = (
    await request(
      '/sales',
      'POST',
      order({
        items,
        discountPercent: 33,
        paymentMethod: 'card',
        cashReceivedCents: null,
        orderType: 'takeaway',
      }),
    )
  ).body;
  assert.equal(sale.discountCents, 67);
  assert.equal(sale.totalCents, 136);
  assert.equal(
    sale.items.reduce((sum, line) => sum + line.totalCents, 0),
    136,
  );
  assert.equal(
    sale.items.reduce((sum, line) => sum + line.discountCents, 0),
    67,
  );
  assert.equal(
    sale.items.reduce((sum, line) => sum + line.vatCents, 0),
    sale.vatCents,
  );
  assert.equal(sale.cashReceivedCents, null);
  assert.equal(sale.tableNumber, null);
  const free = (
    await request('/sales', 'POST', order({ items, discountPercent: 100, cashReceivedCents: 0 }))
  ).body;
  assert.equal(free.totalCents, 0);
  assert.equal(free.vatCents, 0);
});

test('local API refuses cross-origin writes and invalid JSON', async (t) => {
  const { request, base } = await fixture(t);
  assert.equal(
    (await request('/sales', 'POST', order(), { Origin: 'https://untrusted.example' })).status,
    403,
  );
  assert.equal(
    (await request('/sales', 'POST', order(), { 'Content-Type': 'text/plain' })).status,
    415,
  );
  const bad = await fetch(`${base}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(bad.status, 400);
  assert.equal((await request('/sales/nope')).status, 400);
  assert.equal((await request('/sales/999')).status, 404);
  assert.equal((await request('/missing')).status, 404);
});

test('disk database survives restart without reseeding or losing sales', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'mlynek-db-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'pos.sqlite');
  let db = openDatabase(path);
  db.prepare('UPDATE products SET stock = 7 WHERE id = 1').run();
  const { sale } = createSale(db, order());
  db.close();
  db = openDatabase(path);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 15);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 1').get().stock, 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n, 17);
  assert.equal(getSale(db, sale.id).totalCents, 3690);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 3').get().stock, 48);
  db.close();
});

test('daily reports use the Warsaw business day across UTC midnight', () => {
  assert.equal(businessDay(new Date('2026-11-18T23:30:00Z')), '2026-11-19');
  assert.equal(businessDay(new Date('2026-07-01T22:30:00Z')), '2026-07-02');
});

test('development proxy permits same-origin checkout and preserves cross-origin protection', async (t) => {
  const { base } = await fixture(t);
  const { createServer } = await import('vite');
  const { default: config } = await import('../vite.config.ts');
  const vite = await createServer({
    ...config,
    configFile: false,
    logLevel: 'silent',
    server: {
      ...config.server,
      port: 0,
      strictPort: false,
      proxy: { '/api': { ...config.server.proxy['/api'], target: base } },
    },
  });
  t.after(() => vite.close());
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const response = await fetch(`${origin}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(order()),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).totalCents, 3690);
  const rejected = await fetch(`${origin}/api/sales`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: JSON.stringify(order()),
  });
  assert.equal(rejected.status, 403);
});
