import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const menu = [
  ['Espresso', 'Kawa', 900, 23, 80],
  ['Americano', 'Kawa', 1200, 23, 60],
  ['Cappuccino', 'Kawa', 1500, 23, 50],
  ['Flat white', 'Kawa', 1600, 23, 50],
  ['Caffè latte', 'Kawa', 1700, 23, 40],
  ['Latte waniliowe', 'Kawa', 1900, 23, 35],
  ['Croissant maślany', 'Wypieki', 1100, 5, 18],
  ['Pain au chocolat', 'Wypieki', 1400, 5, 12],
  ['Sernik waniliowy', 'Wypieki', 2200, 8, 10],
  ['Lemoniada cytrynowa', 'Napoje', 1800, 23, 25],
  ['Matcha latte', 'Napoje', 2100, 23, 20],
  ['Woda mineralna', 'Napoje', 800, 23, 30],
  ['Bajgiel z awokado', 'Jedzenie', 2900, 8, 8],
  ['Tost z mozzarellą', 'Jedzenie', 2500, 8, 12],
  ['Kanapka śniadaniowa', 'Jedzenie', 2700, 8, 6],
];

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      price_cents INTEGER NOT NULL CHECK(price_cents > 0),
      vat_rate INTEGER NOT NULL CHECK(vat_rate IN (0,5,8,23)),
      stock INTEGER NOT NULL CHECK(stock >= 0), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, business_day TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided')),
      subtotal_cents INTEGER NOT NULL, discount_percent INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL,
      payment_method TEXT NOT NULL, cash_received_cents INTEGER,
      order_type TEXT NOT NULL, table_number INTEGER, note TEXT NOT NULL,
      voided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id),
      product_id INTEGER NOT NULL REFERENCES products(id), name TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL,
      vat_rate INTEGER NOT NULL, discount_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL, vat_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
      sale_id INTEGER REFERENCES sales(id), quantity INTEGER NOT NULL,
      reason TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS sales_business_day ON sales(business_day, status);
    CREATE INDEX IF NOT EXISTS sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS stock_movements_product ON stock_movements(product_id, id);
  `);
  if (!db.prepare("SELECT value FROM app_meta WHERE key = 'seeded'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT COUNT(*) AS count FROM products').get().count === 0) {
        const insert = db.prepare(
          'INSERT INTO products (name,category,price_cents,vat_rate,stock) VALUES (?,?,?,?,?)',
        );
        const movement = db.prepare(
          'INSERT INTO stock_movements (product_id,quantity,reason,created_at) VALUES (?,?,?,?)',
        );
        for (const row of menu) {
          const result = insert.run(...row);
          movement.run(
            result.lastInsertRowid,
            row[4],
            'Stan początkowy — dane demonstracyjne',
            new Date().toISOString(),
          );
        }
      }
      db.prepare("INSERT INTO app_meta (key,value) VALUES ('seeded','1')").run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
