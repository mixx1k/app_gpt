import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const svg = await readFile('public/favicon.svg', 'utf8');
await mkdir('desktop/assets', { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: process.env.CI ? ['--no-sandbox'] : [],
});
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
  );
  async function png(size) {
    await page.locator('svg').evaluate((element, dimension) => {
      element.setAttribute('width', String(dimension));
      element.setAttribute('height', String(dimension));
    }, size);
    return page.locator('svg').screenshot({ omitBackground: true });
  }
  await writeFile('desktop/assets/icon.png', await png(512));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push(await png(size));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  await writeFile('desktop/assets/icon.ico', Buffer.concat([header, ...images]));
} finally {
  await browser.close();
}
