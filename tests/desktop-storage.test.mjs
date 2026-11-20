import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.mjs';
import { createSale } from '../server/sales.mjs';
import { saveSnapshot } from '../desktop/storage.mjs';
import { randomUUID } from 'node:crypto';

test('desktop backup captures a live database and refuses overwriting the active database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'mlynek-backup-'));
  const path = join(directory, 'pos.sqlite');
  const target = join(directory, 'backups', 'copy.sqlite');
  const db = openDatabase(path);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  createSale(db, {
    requestId: randomUUID(),
    items: [{ productId: 1, quantity: 1, expectedPriceCents: 900 }],
    discountPercent: 0,
    paymentMethod: 'cash',
    cashReceivedCents: 1000,
    orderType: 'takeaway',
    tableNumber: null,
    note: '',
  });
  await saveSnapshot(db, path, target);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(copy.prepare('SELECT total_cents FROM sales').get().total_cents, 900);
    assert.equal(copy.prepare('SELECT stock FROM products WHERE id = 1').get().stock, 79);
  } finally {
    copy.close();
  }
  const before = await readFile(target);
  await assert.rejects(saveSnapshot(db, path, target), /już istnieje/);
  assert.deepEqual(await readFile(target), before);
  await assert.rejects(saveSnapshot(db, path, path, { overwrite: true }), /inną ścieżkę/);
  await assert.rejects(saveSnapshot(db, path, `${path}-wal`, { overwrite: true }), /inną ścieżkę/);
  assert.deepEqual(await readdir(join(directory, 'backups')), ['copy.sqlite']);
});
