import { app, BrowserWindow, Menu, dialog, protocol, session, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { businessDay } from '../server/sales.mjs';
import { saveSnapshot } from './storage.mjs';

const origin = 'mlynek://app';
const desktopDirectory = fileURLToPath(new URL('.', import.meta.url));
const projectDirectory = resolve(desktopDirectory, '..');
app.setName('Mlynek POS');
app.setAppUserModelId('pl.mlynek.pos');
if (process.env.POS_DESKTOP_USER_DATA) {
  const directory = resolve(process.env.POS_DESKTOP_USER_DATA);
  mkdirSync(directory, { recursive: true });
  app.setPath('userData', directory);
}
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mlynek',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let window;
let server;
let database;
let backendOrigin;
let databasePath;
let closing = false;
let cleanupComplete = false;
let backupTask = null;

function trustedURL(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'mlynek:' &&
      url.hostname === 'app' &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

async function exportBackup() {
  if (backupTask) return;
  const result = await dialog.showSaveDialog(window, {
    title: 'Zapisz kopię bazy Młynek POS',
    defaultPath: join(
      app.getPath('documents'),
      `Mlynek-POS-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
    ),
    filters: [{ name: 'Baza SQLite', extensions: ['sqlite'] }],
  });
  if (result.canceled || !result.filePath) return;
  backupTask = saveSnapshot(database, databasePath, result.filePath, { overwrite: true });
  try {
    await backupTask;
    await dialog.showMessageBox(window, {
      type: 'info',
      title: 'Kopia zapisana',
      message: 'Zapisano kopię bazy.',
      detail: result.filePath,
    });
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error',
      title: 'Nie zapisano kopii',
      message: error.message,
    });
  } finally {
    backupTask = null;
  }
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Plik',
        submenu: [
          {
            label: 'Utwórz kopię zapasową…',
            accelerator: 'CommandOrControl+Shift+B',
            click: () => void exportBackup(),
          },
          {
            label: 'Otwórz folder danych',
            click: async () => {
              const error = await shell.openPath(app.getPath('userData'));
              if (error) dialog.showErrorBox('Folder danych', error);
            },
          },
          { type: 'separator' },
          { label: 'Zamknij', role: 'quit' },
        ],
      },
      {
        label: 'Edycja',
        submenu: [
          { label: 'Cofnij', role: 'undo' },
          { label: 'Ponów', role: 'redo' },
          { type: 'separator' },
          { label: 'Wytnij', role: 'cut' },
          { label: 'Kopiuj', role: 'copy' },
          { label: 'Wklej', role: 'paste' },
          { label: 'Zaznacz wszystko', role: 'selectAll' },
        ],
      },
      {
        label: 'Widok',
        submenu: [
          { label: 'Odśwież', role: 'reload' },
          { type: 'separator' },
          { label: 'Powiększ', role: 'zoomIn' },
          { label: 'Pomniejsz', role: 'zoomOut' },
          { label: 'Rozmiar domyślny', role: 'resetZoom' },
          { type: 'separator' },
          { label: 'Pełny ekran', role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Pomoc',
        submenu: [
          {
            label: 'O programie',
            click: () =>
              void dialog.showMessageBox(window, {
                type: 'info',
                title: 'Młynek POS',
                message: `Młynek POS ${app.getVersion()}`,
                detail:
                  'Aplikacja dla kawiarni. Menu i sprzedaż działają lokalnie, bez Internetu.\n\nWersja demonstracyjna: bez fiskalizacji i integracji terminala.\nDane: ' +
                  app.getPath('userData'),
              }),
          },
        ],
      },
    ]),
  );
}

async function start() {
  await app.whenReady();
  const staticDirectory = join(projectDirectory, 'dist');
  if (!existsSync(join(staticDirectory, 'index.html')))
    throw new Error('Brakuje zbudowanego interfejsu. W projekcie uruchom npm run build.');
  const dataDirectory = join(app.getPath('userData'), 'data');
  databasePath = join(dataDirectory, 'pos.sqlite');
  database = openDatabase(databasePath);
  const automaticBackup = join(app.getPath('userData'), 'backups', `auto-${businessDay()}.sqlite`);
  if (!existsSync(automaticBackup)) await saveSnapshot(database, databasePath, automaticBackup);
  const token = randomBytes(32).toString('hex');
  const api = createApp(database, { staticDir: staticDirectory, accessToken: token });
  server = api.listen(0, '127.0.0.1');
  await new Promise((resolveReady, reject) => {
    server.once('listening', resolveReady);
    server.once('error', reject);
  });
  backendOrigin = `http://127.0.0.1:${server.address().port}`;

  // A stable, secure origin keeps carts and payment retry keys across restarts.
  // Only this handler knows the random loopback address and its access token.
  protocol.handle('mlynek', async (request) => {
    if (!trustedURL(request.url)) return new Response('Niedozwolony adres.', { status: 403 });
    const url = new URL(request.url);
    try {
      const response = await fetch(`${backendOrigin}${url.pathname}${url.search}`, {
        method: request.method,
        headers: {
          'Content-Type': request.headers.get('content-type') || 'application/json',
          Authorization: `Bearer ${token}`,
          Origin: backendOrigin,
        },
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
        redirect: 'error',
      });
      const headers = new Headers(response.headers);
      headers.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'",
      );
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return Response.json(
        { error: 'Nie udało się połączyć z lokalną bazą. Uruchom ponownie aplikację.' },
        { status: 503 },
      );
    }
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Młynek POS',
    backgroundColor: '#f6f7f3',
    icon: join(desktopDirectory, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!trustedURL(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => {
    if (!closing)
      dialog.showErrorBox(
        'Błąd okna POS',
        `Uruchom ponownie aplikację. Zapisane zamówienia pozostają w bazie.\n${details.reason}`,
      );
  });
  window.on('closed', () => {
    window = null;
  });
  installMenu();
  await window.loadURL(`${origin}/`);
  window.show();
}

async function cleanup() {
  closing = true;
  try {
    if (backupTask) await backupTask.catch(() => {});
    if (server) {
      await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeIdleConnections();
      });
    }
    if (database) {
      database.close();
      database = null;
    }
  } finally {
    cleanupComplete = true;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!cleanupComplete) {
      event.preventDefault();
      if (!closing) void cleanup().finally(() => app.quit());
    }
  });
  start().catch(async (error) => {
    console.error('Desktop startup failed:', error.message);
    await app.whenReady();
    dialog.showErrorBox('Nie można uruchomić Młynek POS', error.message);
    app.quit();
  });
}
