import { createHash } from 'node:crypto';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const businessDay = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export function productView(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    priceCents: row.price_cents,
    vatRate: row.vat_rate,
    stock: row.stock,
    active: Boolean(row.active),
  };
}

export function getSale(db, id) {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
  if (!sale) throw new AppError(404, 'Nie znaleziono zamówienia.');
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id);
  return {
    id: sale.id,
    number: `K/${sale.business_day.slice(0, 4)}/${String(sale.id).padStart(5, '0')}`,
    createdAt: sale.created_at,
    status: sale.status,
    voidedAt: sale.voided_at,
    subtotalCents: sale.subtotal_cents,
    discountPercent: sale.discount_percent,
    discountCents: sale.discount_cents,
    totalCents: sale.total_cents,
    vatCents: sale.vat_cents,
    paymentMethod: sale.payment_method,
    cashReceivedCents: sale.cash_received_cents,
    changeCents:
      sale.cash_received_cents === null ? 0 : sale.cash_received_cents - sale.total_cents,
    orderType: sale.order_type,
    tableNumber: sale.table_number,
    note: sale.note,
    items: items.map((row) => ({
      productId: row.product_id,
      name: row.name,
      quantity: row.quantity,
      unitPriceCents: row.unit_price_cents,
      vatRate: row.vat_rate,
      discountCents: row.discount_cents,
      totalCents: row.total_cents,
      vatCents: row.vat_cents,
    })),
  };
}

export function createSale(db, input) {
  const { requestId, ...payload } = input;
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing = db
      .prepare('SELECT id, request_hash FROM sales WHERE request_id = ?')
      .get(requestId);
    if (existing) {
      if (existing.request_hash !== hash)
        throw new AppError(409, 'Identyfikator płatności został już użyty dla innego zamówienia.');
      const sale = getSale(db, existing.id);
      db.exec('COMMIT');
      return { sale, replay: true };
    }
    const lines = input.items.map((item) => {
      const product = db
        .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
        .get(item.productId);
      if (!product) throw new AppError(409, 'Produkt nie jest już dostępny. Odśwież menu.');
      if (product.stock < item.quantity)
        throw new AppError(
          409,
          `Za mało produktu „${product.name}” w magazynie (dostępne: ${product.stock}).`,
        );
      if (product.price_cents !== item.expectedPriceCents)
        throw new AppError(
          409,
          `Cena produktu „${product.name}” zmieniła się. Odśwież koszyk przed płatnością.`,
        );
      return { product, quantity: item.quantity, gross: product.price_cents * item.quantity };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.gross, 0);
    const discount = Math.round((subtotal * input.discountPercent) / 100);
    // Allocate the rounded order discount in cents, preserving the exact total.
    const allocations = lines.map((line, i) => {
      const numerator = BigInt(discount) * BigInt(line.gross);
      return {
        i,
        value: Number(numerator / BigInt(subtotal)),
        remainder: Number(numerator % BigInt(subtotal)),
      };
    });
    let left = discount - allocations.reduce((sum, a) => sum + a.value, 0);
    for (const allocation of [...allocations].sort(
      (a, b) => b.remainder - a.remainder || a.i - b.i,
    )) {
      if (left-- > 0) allocation.value++;
    }
    for (const [i, line] of lines.entries()) {
      line.discount = allocations[i].value;
      line.total = line.gross - line.discount;
      line.vat = line.total - Math.round((line.total * 100) / (100 + line.product.vat_rate));
    }
    const total = subtotal - discount;
    if (
      input.paymentMethod === 'cash' &&
      (input.cashReceivedCents === null || input.cashReceivedCents < total)
    ) {
      throw new AppError(422, 'Przyjęta gotówka nie wystarcza na opłacenie zamówienia.');
    }
    const now = new Date();
    const result = db
      .prepare(
        `INSERT INTO sales (
      request_id,request_hash,created_at,business_day,subtotal_cents,discount_percent,discount_cents,
      total_cents,vat_cents,payment_method,cash_received_cents,order_type,table_number,note
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        requestId,
        hash,
        now.toISOString(),
        businessDay(now),
        subtotal,
        input.discountPercent,
        discount,
        total,
        lines.reduce((sum, line) => sum + line.vat, 0),
        input.paymentMethod,
        input.paymentMethod === 'cash' ? input.cashReceivedCents : null,
        input.orderType,
        input.orderType === 'dine_in' ? input.tableNumber : null,
        input.note,
      );
    const id = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`INSERT INTO sale_items
      (sale_id,product_id,name,quantity,unit_price_cents,vat_rate,discount_cents,total_cents,vat_cents)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const line of lines) {
      insertItem.run(
        id,
        line.product.id,
        line.product.name,
        line.quantity,
        line.product.price_cents,
        line.product.vat_rate,
        line.discount,
        line.total,
        line.vat,
      );
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(
        line.quantity,
        line.product.id,
      );
      db.prepare(
        'INSERT INTO stock_movements (product_id,sale_id,quantity,reason,created_at) VALUES (?,?,?,?,?)',
      ).run(line.product.id, id, -line.quantity, 'Sprzedaż', now.toISOString());
    }
    const sale = getSale(db, id);
    db.exec('COMMIT');
    return { sale, replay: false };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function voidSale(db, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const sale = getSale(db, id);
    if (sale.status === 'completed') {
      for (const item of sale.items) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(
          item.quantity,
          item.productId,
        );
        db.prepare(
          'INSERT INTO stock_movements (product_id,sale_id,quantity,reason,created_at) VALUES (?,?,?,?,?)',
        ).run(item.productId, id, item.quantity, 'Anulowanie sprzedaży', new Date().toISOString());
      }
      db.prepare("UPDATE sales SET status = 'voided', voided_at = ? WHERE id = ?").run(
        new Date().toISOString(),
        id,
      );
    }
    const updated = getSale(db, id);
    db.exec('COMMIT');
    return updated;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
