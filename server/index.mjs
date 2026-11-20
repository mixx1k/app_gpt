import { resolve } from 'node:path';
import { openDatabase } from './db.mjs';
import { createApp } from './app.mjs';

const db = openDatabase(resolve(process.env.POS_DB_PATH || 'data/pos.sqlite'));
const port = Number(process.env.PORT || 3001);
const server = createApp(db).listen(port, '127.0.0.1', () => {
  console.log(`Młynek POS: serwer działa na porcie ${port}. Baza SQLite gotowa.`);
});
server.on('error', (error) => {
  console.error(error.message);
  db.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
}
