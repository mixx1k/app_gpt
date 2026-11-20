import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// NSIS embeds its uninstaller directly. No Windows executable needs to run
// on the build host, and uninstall removes only files shipped by this build.
export default async function prepareInstaller(context) {
  if (context.electronPlatformName !== 'win32') return;
  const files = [];
  const directories = [];
  async function walk(relative = '') {
    const entries = await readdir(join(context.appOutDir, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        directories.push(path);
        await walk(path);
      } else if (entry.isFile()) files.push(path);
      else throw new Error(`Nieobsługiwany plik w paczce Windows: ${path}`);
    }
  }
  await walk();
  const escape = (value) => value.replaceAll('$', () => '$$').replaceAll('"', '$\\"');
  const windowsPath = (value) => escape(value.replaceAll('/', '\\'));
  const script = [
    `!define MLYNEK_APP_DIR "${escape(context.appOutDir)}"`,
    '!macro MlynekRemoveInstalledFiles',
    ...files.map((path) => `  Delete "$INSTDIR\\${windowsPath(path)}"`),
    ...directories
      .sort((a, b) => b.split('/').length - a.split('/').length)
      .map((path) => `  RMDir "$INSTDIR\\${windowsPath(path)}"`),
    '!macroend',
    '',
  ].join('\n');
  const output = join(context.packager.projectDir, 'build', 'generated');
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'installer-files.nsh'), script, 'utf8');
}
