import { test, expect } from '@playwright/test';

test('cashier sells coffee and pastry with a table, note, discount, change and receipt', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByText('Połączono', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj Cappuccino', exact: true }).click();
  await page.getByRole('button', { name: 'Zwiększ Cappuccino', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj Croissant maślany', exact: true }).click();
  await page.getByRole('combobox', { name: 'Numer stolika' }).selectOption('3');
  await page.getByRole('textbox', { name: 'Uwagi do zamówienia' }).fill('Bez cukru');
  await page.getByRole('button', { name: 'Dodaj rabat' }).click();
  await page.getByRole('spinbutton', { name: 'Rabat procentowy' }).fill('10');
  await page.getByRole('button', { name: 'Przejdź do płatności' }).click();
  await page.getByLabel('Przyjęta gotówka (zł)').fill('50');
  await expect(page.getByRole('dialog')).toContainText('13,10');
  await page.getByRole('button', { name: 'Potwierdź otrzymanie płatności' }).click();
  await expect(page.getByRole('dialog')).toContainText('Podsumowanie zamówienia');
  await expect(page.getByRole('dialog')).toContainText('36,90');
  await expect(page.getByRole('dialog')).toContainText('stolik 3');
  await expect(page.getByRole('dialog')).toContainText('Bez cukru');
  await expect(page.getByRole('dialog')).toContainText('DOKUMENT NIEFISKALNY');
  const sales = await (await request.get('/api/sales')).json();
  expect(sales[0].totalCents).toBe(3690);
  expect(sales[0].vatCents).toBe(552);
  const products = await (await request.get('/api/products')).json();
  expect(products.find((p: { id: number }) => p.id === 3).stock).toBe(48);
  await page.getByRole('button', { name: 'Gotowe', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Przejdź do płatności' })).toBeDisabled();
});

test('menu search, category filters and cart survive a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Wypieki', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dodaj Espresso', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Szukaj produktu' }).fill('croissant');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dodaj Croissant maślany', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Zmniejsz Croissant maślany' })).toBeVisible();
  await page.getByRole('button', { name: 'Wyczyść koszyk' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Wyczyść koszyk', exact: true })
    .click();
  await expect(page.getByText('Tu zaczyna się coś dobrego')).toBeVisible();
});

test('manager adds a product, receives stock, sells it and voids it only once', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu i magazyn', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj produkt', exact: true }).click();
  await page.getByLabel('Nazwa produktu', { exact: true }).fill('Ciastko E2E');
  await page.getByRole('combobox', { name: 'Kategoria', exact: true }).selectOption('Wypieki');
  await page.getByLabel('Cena brutto (zł)', { exact: true }).fill('12,50');
  await page.getByRole('combobox', { name: 'Stawka VAT', exact: true }).selectOption('5');
  await page.getByRole('button', { name: 'Zapisz produkt', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Ciastko E2E' });
  await expect(row).toContainText('0 szt.');
  await row.getByRole('button', { name: 'Stan', exact: true }).click();
  await page.getByLabel('Liczba sztuk', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Zapisz zmianę stanu', exact: true }).click();
  await expect(row).toContainText('4 szt.');
  await page.getByRole('button', { name: 'Sprzedaż', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj Ciastko E2E', exact: true }).click();
  await page.getByRole('button', { name: 'Na wynos', exact: true }).click();
  await page.getByRole('button', { name: 'Przejdź do płatności' }).click();
  await page.getByRole('button', { name: 'Karta', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('nie pobiera pieniędzy z karty');
  await page.getByRole('button', { name: 'Potwierdź otrzymanie płatności' }).click();
  await expect(page.getByRole('dialog')).toContainText('Podsumowanie zamówienia');
  await page.getByRole('button', { name: 'Anuluj sprzedaż i przywróć stan' }).click();
  await page.getByRole('button', { name: 'Anuluj sprzedaż', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('ANULOWANO');
  await expect(page.getByRole('button', { name: 'Anuluj sprzedaż i przywróć stan' })).toHaveCount(
    0,
  );
  const products = await (await request.get('/api/products')).json();
  expect(products.find((p: { name: string }) => p.name === 'Ciastko E2E').stock).toBe(4);
});

test('lost sale response can be retried after reload without duplicating the transaction', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dodaj Espresso', exact: true }).click();
  await page.getByRole('button', { name: 'Przejdź do płatności' }).click();
  const before = (await (await request.get('/api/sales')).json()).length;
  let dropped = false;
  await page.route('**/api/sales', async (route) => {
    if (route.request().method() === 'POST' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Potwierdź otrzymanie płatności' }).click();
  await expect(page.getByRole('button', { name: 'Ponów potwierdzenie' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Zamknij okno' })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Ponów potwierdzenie' }).click();
  await expect(page.getByRole('dialog')).toContainText('Podsumowanie zamówienia');
  expect((await (await request.get('/api/sales')).json()).length).toBe(before + 1);
});

test('mobile layout fits the viewport and supports checkout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Dodaj Flat white', exact: true }).click();
  await page.getByRole('button', { name: 'Przejdź do płatności' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Potwierdź otrzymanie płatności' }).click();
  await expect(page.getByRole('dialog')).toContainText('Podsumowanie zamówienia');
});
