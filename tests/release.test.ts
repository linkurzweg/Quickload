import { describe, expect, it } from 'vite-plus/test';
import { nextVersion } from '../scripts/release.mjs';
import { createUpdateManifest } from '../scripts/update-manifest.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('release version policy', () => {
  it('keeps app manifests and workspace lockfile versions aligned without changing dependencies', () => {
    const root = mkdtempSync(join(tmpdir(), 'quickload-release-'));
    try {
      mkdirSync(join(root, 'src-tauri'), { recursive: true });
      mkdirSync(join(root, 'crates/quickload-core'), { recursive: true });
      for (const path of ['package.json', 'src-tauri/tauri.conf.json'])
        writeFileSync(join(root, path), '{"version":"0.1.0"}');
      for (const path of ['src-tauri/Cargo.toml', 'crates/quickload-core/Cargo.toml'])
        writeFileSync(join(root, path), '[package]\nversion = "0.1.0"\n');
      writeFileSync(
        join(root, 'Cargo.lock'),
        ['quickload', 'quickload-core', 'serde']
          .map((name) => `[[package]]\nname = "${name}"\nversion = "0.1.0"\n`)
          .join('\n'),
      );
      execFileSync(process.execPath, [resolve('scripts/release.mjs'), 'apply', '1.2.3'], {
        cwd: root,
      });
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('1.2.3');
      expect(
        JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')).version,
      ).toBe('1.2.3');
      const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
      expect(lock.match(/version = "1.2.3"/g)).toHaveLength(2);
      expect(lock).toContain('name = "serde"\nversion = "0.1.0"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('releases fixes and maintenance as patches', () => {
    expect(nextVersion('0.1.0', ['fix(ui): restore focus'])).toBe('0.1.1');
    expect(nextVersion('1.9.9', ['docs: clarify setup'])).toBe('1.9.10');
  });
  it('selects the highest impact across merged commits', () => {
    expect(nextVersion('0.1.8', ['fix: title', 'feat(input): add triggers'])).toBe('0.2.0');
    expect(nextVersion('0.1.8', ['feat: page', 'refactor(api)!: change launch contract'])).toBe(
      '1.0.0',
    );
    expect(nextVersion('1.2.3', ['fix: format\n\nBREAKING CHANGE: preferences schema'])).toBe(
      '2.0.0',
    );
  });
});
describe('signed updater feed', () => {
  const assets = [
    'Quickload-setup.exe',
    'Quickload.msi',
    'Quickload.AppImage',
    'Quickload.app.tar.gz',
  ];

  it('maps each installer separately and shares the universal macOS bundle', () => {
    const manifest = createUpdateManifest('v1.2.3', assets, (file: string) => ` ${file}\n`);
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.platforms['windows-x86_64-msi'].url).toMatch(/\/v1\.2\.3\/Quickload\.msi$/);
    expect(manifest.platforms['windows-x86_64-nsis'].signature).toBe('Quickload-setup.exe.sig');
    expect(manifest.platforms['darwin-aarch64-app']).toEqual(
      manifest.platforms['darwin-x86_64-app'],
    );
    expect(Object.keys(manifest.platforms)).toHaveLength(5);
  });

  it('omits the Linux updater entry when the release only includes DEB and RPM', () => {
    const manifest = createUpdateManifest(
      'v1.2.3',
      assets.filter((file) => !file.endsWith('.AppImage')),
      () => 'signed',
    );
    expect(manifest.platforms).not.toHaveProperty('linux-x86_64-appimage');
    expect(Object.keys(manifest.platforms)).toHaveLength(4);
  });

  it('refuses incomplete releases', () => {
    expect(() => createUpdateManifest('v1.2.3', assets.slice(0, 3), () => 'signed')).toThrow(
      'Expected one .app.tar.gz updater asset.',
    );
    expect(() => createUpdateManifest('v1.2.3', assets, () => ' ')).toThrow('Missing signature');
  });
});
