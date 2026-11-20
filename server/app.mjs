import express from 'express';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError, businessDay, createSale, getSale, productView, voidSale } from './sales.mjs';

const productSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    category: z.enum(['Kawa', 'Wypieki', 'Napoje', 'Jedzenie']),
    priceCents: z.number().int().min(1).max(1000000),
    vatRate: z.union([z.literal(0), z.literal(5), z.literal(8), z.literal(23)]),
  })
  .strict();
const saleSchema = z
  .object({
    requestId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            productId: z.number().int().positive(),
            quantity: z.number().int().min(1).max(999),
            expectedPriceCents: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine((items) => new Set(items.map((item) => item.productId)).size === items.length),
    discountPercent: z.number().int().min(0).max(100).default(0),
    paymentMethod: z.enum(['cash', 'card']),
    cashReceivedCents: z.number().int().min(0).max(100000000000).nullable().default(null),
    orderType: z.enum(['dine_in', 'takeaway']),
    tableNumber: z.number().int().min(1).max(99).nullable().default(null),
    note: z.string().trim().max(300).default(''),
  })
  .strict();
const parseId = (value) => {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1)
    throw new AppError(400, 'Nieprawidłowy identyfikator.');
  return Number(value);
};

export function createApp(db, { staticDir = resolve('dist'), accessToken = null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Desktop requests arrive through a private protocol handler, never directly
  // from another browser or application on the machine.
  if (accessToken) {
    app.use((req, res, next) => {
      if (req.get('Authorization') !== `Bearer ${accessToken}`) {
        return res.status(401).json({ error: 'Dostęp tylko z aplikacji Młynek POS.' });
      }
      next();
    });
  }
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!req.is('application/json'))
        return res.status(415).json({ error: 'Wymagany format JSON.' });
      if (req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          return res.status(403).json({ error: 'Niedozwolone źródło żądania.' });
        }
        if (origin.host !== req.headers.host)
          return res.status(403).json({ error: 'Niedozwolone źródło żądania.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', storage: 'sqlite', currency: 'PLN' });
  });
  app.get('/api/products', (_req, res) =>
    res.json(
      db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all().map(productView),
    ),
  );
  app.post('/api/products', (req, res) => {
    const data = productSchema.parse(req.body);
    const result = db
      .prepare('INSERT INTO products (name,category,price_cents,vat_rate,stock) VALUES (?,?,?,?,0)')
      .run(data.name, data.category, data.priceCents, data.vatRate);
    res
      .status(201)
      .json(
        productView(db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid)),
      );
  });
  app.put('/api/products/:id', (req, res) => {
    const id = parseId(req.params.id);
    const data = productSchema.parse(req.body);
    const result = db
      .prepare(
        'UPDATE products SET name = ?, category = ?, price_cents = ?, vat_rate = ? WHERE id = ? AND active = 1',
      )
      .run(data.name, data.category, data.priceCents, data.vatRate, id);
    if (!result.changes) throw new AppError(404, 'Nie znaleziono produktu.');
    res.json(productView(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
  });
  app.post('/api/products/:id/stock', (req, res) => {
    const id = parseId(req.params.id);
    const { quantity, reason } = z
      .object({
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((value) => value !== 0),
        reason: z.string().trim().min(1).max(150),
      })
      .strict()
      .parse(req.body);
    db.exec('BEGIN IMMEDIATE');
    try {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(id);
      if (!product) throw new AppError(404, 'Nie znaleziono produktu.');
      if (product.stock + quantity < 0 || product.stock + quantity > 1000000)
        throw new AppError(422, 'Stan musi wynosić od 0 do 1 000 000 sztuk.');
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(quantity, id);
      db.prepare(
        'INSERT INTO stock_movements (product_id,quantity,reason,created_at) VALUES (?,?,?,?)',
      ).run(id, quantity, reason, new Date().toISOString());
      const updated = productView(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
      db.exec('COMMIT');
      res.json(updated);
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  app.get('/api/products/:id/movements', (req, res) => {
    res.json(
      db
        .prepare(
          'SELECT quantity,reason,created_at AS createdAt FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 100',
        )
        .all(parseId(req.params.id)),
    );
  });
  app.get('/api/summary', (_req, res) => {
    const day = businessDay();
    const summary = db
      .prepare(
        "SELECT COUNT(*) AS orders, COALESCE(SUM(total_cents),0) AS revenueCents FROM sales WHERE business_day = ? AND status = 'completed'",
      )
      .get(day);
    res.json({
      ...summary,
      day,
      averageCents: summary.orders ? Math.round(summary.revenueCents / summary.orders) : 0,
    });
  });
  app.get('/api/sales', (_req, res) =>
    res.json(
      db
        .prepare('SELECT id FROM sales ORDER BY id DESC LIMIT 100')
        .all()
        .map((row) => getSale(db, row.id)),
    ),
  );
  app.get('/api/sales/:id', (req, res) => res.json(getSale(db, parseId(req.params.id))));
  app.post('/api/sales', (req, res) => {
    const { sale, replay } = createSale(db, saleSchema.parse(req.body));
    res.status(replay ? 200 : 201).json(sale);
  });
  app.post('/api/sales/:id/void', (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(voidSale(db, parseId(req.params.id)));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Nie znaleziono zasobu.' }));
  if (existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res.status(400).json({
        error: 'Sprawdź dane formularza: wymagane pola, kwoty i ilości muszą być poprawne.',
      });
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Nieprawidłowy JSON.' });
    if (error.type === 'entity.too.large')
      return res.status(413).json({ error: 'Żądanie jest zbyt duże.' });
    console.error('API error:', error.message);
    res.status(500).json({ error: 'Nie udało się zapisać operacji. Spróbuj ponownie.' });
  });
  return app;
}
