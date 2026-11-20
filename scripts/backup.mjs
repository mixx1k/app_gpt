import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.POS_DB_PATH || 'data/pos.sqlite');
const target = resolve(
  process.argv[2] || `data/backups/pos-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
);
if (!existsSync(source)) throw new Error('Baza nie istnieje. Najpierw uruchom aplikację.');
if (existsSync(target)) throw new Error('Plik docelowy już istnieje. Wybierz nową nazwę kopii.');
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, target);
  console.log(`Zapisano spójną kopię bazy: ${target}`);
} finally {
  db.close();
}
