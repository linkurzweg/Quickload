import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = 'https://github.com/linkurzweg/Quickload';

/**
 * Build a Tauri feed for signed Windows and macOS assets and an optional signed AppImage.
 * @param {string} tag Stable Git release tag.
 * @param {string[]} files Download filenames.
 * @param {(file: string) => string} readSignature Reads the matching signature or throws.
 * @returns The version and per-platform download entries.
 */
export function createUpdateManifest(tag, files, readSignature) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected a stable release tag.');
  /** @type {Record<string, {signature: string, url: string}>} */
  const platforms = {};
  for (const { targets, suffix, optional } of [
    { targets: ['windows-x86_64-nsis'], suffix: '-setup.exe' },
    { targets: ['windows-x86_64-msi'], suffix: '.msi' },
    { targets: ['linux-x86_64-appimage'], suffix: '.AppImage', optional: true },
    { targets: ['darwin-aarch64-app', 'darwin-x86_64-app'], suffix: '.app.tar.gz' },
  ]) {
    const packages = files.filter((file) => file.endsWith(suffix));
    if (optional && packages.length === 0) continue;
    if (packages.length !== 1) throw new Error(`Expected one ${suffix} updater asset.`);
    const [file] = packages;
    const signature = readSignature(`${file}.sig`).trim();
    if (!signature) throw new Error(`Missing signature for ${file}.`);
    const url = `${repository}/releases/download/${tag}/${encodeURIComponent(file)}`;
    for (const target of targets) platforms[target] = { signature, url };
  }
  return { version: tag.slice(1), platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , tag, directory] = process.argv;
  const manifest = createUpdateManifest(tag, readdirSync(directory), (file) =>
    readFileSync(join(directory, file), 'utf8'),
  );
  writeFileSync(join(directory, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
