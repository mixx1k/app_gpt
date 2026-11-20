import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, rename, rm, access } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

function canonical(path) {
  const absolute = resolve(path);
  const value = existsSync(absolute) ? realpathSync(absolute) : absolute;
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

export async function saveSnapshot(db, databasePath, destination, { overwrite = false } = {}) {
  const target = resolve(destination);
  const source = canonical(databasePath);
  const output = canonical(target);
  if ([source, `${source}-wal`, `${source}-shm`].includes(output)) {
    throw new Error('Kopia musi mieć inną ścieżkę niż aktualna baza i jej pliki robocze.');
  }
  if (!overwrite && existsSync(target)) throw new Error('Plik kopii już istnieje.');
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await backup(db, temporary);
    // Export a self-contained database that does not create WAL sidecars when opened.
    const snapshot = new DatabaseSync(temporary);
    try {
      snapshot.exec('PRAGMA journal_mode = DELETE');
    } finally {
      snapshot.close();
    }
    if (!overwrite) {
      // Recheck after the asynchronous backup; never silently replace an existing copy.
      try {
        await access(target);
        throw new Error('Plik kopii już istnieje.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return target;
}
