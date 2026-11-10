import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

// Vite injects runtime preload helpers that appear as virtual modules.
const directories = new Set([realpathSync('node_modules/vite')]);
await build({
  build: { write: false },
  plugins: [
    {
      name: 'quickload-frontend-notices',
      /** Collect package roots for modules that contribute code to the final frontend chunks. */
      generateBundle(_options, bundle) {
        for (const entry of Object.values(bundle)) {
          if (entry.type !== 'chunk') continue;
          for (const [id, module] of Object.entries(entry.modules)) {
            if (!module.renderedLength) continue;
            const root = id
              .replace(/^\0/, '')
              .match(/^(.+\/node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1];
            if (root) directories.add(realpathSync(root));
          }
        }
      },
    },
  ],
});

if (directories.size < 2) throw new Error('No frontend runtime dependencies were found.');
const sections = ['Quickload frontend dependency notices'];
for (const path of [...directories].sort()) {
  const { name, version, license } = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
  const files = readdirSync(path, { withFileTypes: true })
    .filter(
      (file) =>
        file.isFile() && /^(licen[cs]e|notice|copying|copyright)(?:[.-]|$)/i.test(file.name),
    )
    .map((file) => file.name)
    .sort();
  if (!files.length) throw new Error(`Missing license text for ${String(name)}.`);
  const texts = files.map((file) => readFileSync(join(path, file), 'utf8').trim());
  sections.push(`${String(name)} ${String(version)} (${String(license)})\n\n${texts.join('\n\n')}`);
}
writeFileSync(process.argv[2], `${sections.join('\n\n' + '='.repeat(78) + '\n\n')}\n`);
