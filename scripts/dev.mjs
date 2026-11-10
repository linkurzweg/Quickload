import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, '.tools', 'browsers');
const command = process.argv[2] ?? 'desktop';
const windows = process.platform === 'win32';
const cargoBin = join(process.env.USERPROFILE ?? process.env.HOME ?? root, '.cargo', 'bin');
process.env.PATH = [join(root, 'node_modules', '.bin'), cargoBin, process.env.PATH].join(delimiter);
const pnpmEntry = [
  process.env.npm_execpath,
  join(root, '.tools/package-manager/node_modules/pnpm/bin/pnpm.mjs'),
  join(dirname(process.execPath), 'node_modules/pnpm/bin/pnpm.mjs'),
  join(dirname(process.execPath), '../lib/node_modules/pnpm/bin/pnpm.mjs'),
  ...process.env.PATH.split(delimiter).map((folder) => join(folder, windows ? 'pnpm.exe' : 'pnpm')),
].find((path) => path && /pnpm/.test(path) && existsSync(path));
const pnpmCommand =
  pnpmEntry && (/\.[cm]?js$/.test(pnpmEntry) ? [process.execPath, pnpmEntry] : [pnpmEntry]);

/** Run executable `file` with separate `args`; inherit output and stop on failure. */
function run(file, args) {
  const result = spawnSync(file, args, { stdio: 'inherit', env: process.env });
  if (result.error) throw new Error(`${file}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Execute a local package's JavaScript entry `path` with optional CLI `args`. */
function local(path, args = []) {
  const entry = join(root, 'node_modules', path);
  if (!existsSync(entry)) throw new Error('Abhängigkeiten fehlen: node scripts/dev.mjs setup');
  run(process.execPath, [entry, ...args]);
}

/** Check `file` with `args` and return its version output, or null when unavailable. */
function probe(file, args = ['--version']) {
  const result = spawnSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Print installed prerequisites; `native` also requires Rust and Windows C++ tools. */
function doctor(native = false) {
  const expected = readFileSync('.node-version', 'utf8').trim();
  console.log(`Node ${process.versions.node} (Referenz ${expected})`);
  if (Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error('Für reproduzierbare Entwicklung Node 24 verwenden; siehe .node-version.');
  console.log(
    `pnpm: ${pnpmCommand ? probe(pnpmCommand[0], [...pnpmCommand.slice(1), '--version']) : 'fehlt (pnpm 12.18.0 installieren)'}`,
  );
  const cargo = probe('cargo');
  const rustc = probe('rustc');
  console.log(`Rust: ${rustc ?? 'fehlt'}; Cargo: ${cargo ?? 'fehlt'}`);
  let cpp = true;
  if (windows) {
    const vswhere = join(
      process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)',
      'Microsoft Visual Studio/Installer/vswhere.exe',
    );
    cpp =
      existsSync(vswhere) &&
      Boolean(
        probe(vswhere, [
          '-latest',
          '-products',
          '*',
          '-requires',
          'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
          '-property',
          'installationPath',
        ]),
      );
    console.log(`MSVC C++ Build Tools: ${cpp ? 'gefunden' : 'fehlen'}`);
  }
  if (native && (!cargo || !rustc || !cpp))
    throw new Error(
      'Native Voraussetzungen fehlen. Siehe docs/DEVELOPMENT.md; UI: node scripts/dev.mjs ui',
    );
}

try {
  if (command === 'doctor') doctor();
  else if (command === 'setup') {
    doctor();
    if (!pnpmCommand) throw new Error('pnpm fehlt. Siehe docs/DEVELOPMENT.md.');
    run(pnpmCommand[0], [...pnpmCommand.slice(1), 'install', '--frozen-lockfile']);
  } else if (command === 'ui') {
    doctor();
    local('vite-plus/bin/vp', ['dev', '--host', '127.0.0.1']);
  } else if (command === 'desktop') {
    doctor(true);
    process.env.CARGO_TARGET_DIR = join(root, 'target');
    if (windows) process.env.WEBVIEW2_USER_DATA_FOLDER = join(root, '.dev-data', 'webview2');
    // Keep development data separate from the installed app and portable releases.
    mkdirSync('target/debug', { recursive: true });
    writeFileSync('target/debug/quickload.portable', 'Quickload development data\n');
    local('@tauri-apps/cli/tauri.js', ['dev', '--', '--locked']);
  } else if (command === 'build') {
    doctor(true);
    local('@tauri-apps/cli/tauri.js', ['build', ...process.argv.slice(3), '--', '--locked']);
  } else if (command === 'e2e') local('@playwright/test/cli.js', ['test']);
  else if (command === 'browsers') local('@playwright/test/cli.js', ['install', 'chromium']);
  else if (command === 'verify' || command === 'frontend' || command === 'check') {
    doctor(command === 'verify');
    local('vite-plus/bin/vp', ['check', '--deny-warnings']);
    local('svelte-check/bin/svelte-check', ['--tsconfig', './tsconfig.json']);
    if (command === 'check') process.exit(0);
    local('vite-plus/bin/vp', ['test', 'run']);
    local('vite-plus/bin/vp', ['build']);
    if (command === 'frontend') process.exit(0);
    run('cargo', ['fmt', '--all', '--', '--check']);
    run('cargo', ['test', '--workspace', '--locked']);
    run('cargo', ['clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings']);
  } else
    throw new Error(
      `Unbekannter Befehl: ${command}. Erlaubt: setup, doctor, ui, desktop, build, browsers, e2e, check, frontend, verify.`,
    );
} catch (error) {
  console.error(`\nQuickload: ${error.message}`);
  process.exitCode = 1;
}
