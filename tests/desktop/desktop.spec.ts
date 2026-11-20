import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let directory: string;
let application: ElectronApplication | undefined;
const appArguments = process.env.POS_PACKAGED_APP ? [] : ['.'];

async function launch() {
  const environment = { ...process.env, POS_DESKTOP_USER_DATA: directory };
  delete environment.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath: process.env.POS_PACKAGED_APP || undefined,
    args: [
      ...appArguments,
      ...(process.env.CI && process.platform === 'linux'
        ? ['--no-sandbox', '--disable-gpu', '--ozone-platform=headless']
        : []),
    ],
    cwd: resolve('.'),
    env: environment,
  });
  const page = await application.firstWindow();
  await expect(page.getByText('Połączono', { exact: true })).toBeVisible();
  return page;
}

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mlynek-desktop-test-'));
});
test.afterEach(async () => {
  if (application) {
    await application.close();
    application = undefined;
  }
  await rm(directory, { recursive: true, force: true });
});

test('desktop window contains the menu, uses a private origin and isolates Node.js', async () => {
  const page = await launch();
  expect(page.url()).toBe('mlynek://app/');
  await expect(page.getByRole('button', { name: 'Dodaj Cappuccino', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => ({
      node: typeof (globalThis as any).require,
      secure: isSecureContext,
    })),
  ).toEqual({ node: 'undefined', secure: true });
  const preferences = await application!.evaluate(({ BrowserWindow, Menu, app }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const prefs = window.webContents.getLastWebPreferences();
    return {
      isolated: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      node: prefs.nodeIntegration,
      menu: Menu.getApplicationMenu()!.items.map((item) => item.label),
      data: app.getPath('userData'),
    };
  });
  expect(preferences).toMatchObject({
    isolated: true,
    sandbox: true,
    node: false,
    menu: ['Plik', 'Edycja', 'Widok', 'Pomoc'],
    data: directory,
  });
  expect(
    (await readdir(join(directory, 'backups'))).filter((name) => name.endsWith('.sqlite')),
  ).toHaveLength(1);
});

test('sales and unfinished cart survive closing and reopening the desktop app', async () => {
  let page = await launch();
  await page.getByRole('button', { name: 'Dodaj Cappuccino', exact: true }).click();
  await page.getByRole('button', { name: 'Przejdź do płatności' }).click();
  await page.getByLabel('Przyjęta gotówka (zł)').fill('20');
  await page.getByRole('button', { name: 'Potwierdź otrzymanie płatności' }).click();
  await expect(page.getByRole('dialog')).toContainText('Podsumowanie zamówienia');
  await expect(page.getByRole('dialog')).toContainText('5,00');
  await page.getByRole('button', { name: 'Gotowe', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj Espresso', exact: true }).click();
  await application!.close();
  application = undefined;
  page = await launch();
  await expect(page.getByRole('button', { name: 'Zmniejsz Espresso', exact: true })).toBeVisible();
  const stored = await page.evaluate(async () => ({
    sales: await (await fetch('/api/sales')).json(),
    products: await (await fetch('/api/products')).json(),
  }));
  expect(stored.sales).toHaveLength(1);
  expect(stored.sales[0].totalCents).toBe(1500);
  expect(stored.products.find((product: { id: number }) => product.id === 3).stock).toBe(49);
});

test('external windows are refused and only application resources are requested', async () => {
  const page = await launch();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.reload();
  await expect(page.getByText('Połączono', { exact: true })).toBeVisible();
  await page.evaluate(() => window.open('https://example.com', '_blank'));
  expect(application!.windows()).toHaveLength(1);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => url.startsWith('mlynek://app/'))).toBe(true);
});
