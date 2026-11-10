import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Choose the next stable SemVer from `previous` and complete conventional commit `messages`. */
export function nextVersion(previous, messages) {
  const parts = previous.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part) || part < 0))
    throw new Error('Invalid stable version');
  const breaking = messages.some(
    (message) =>
      /^[a-z]+(?:\([^\r\n)]+\))?!: /m.test(message) || /^BREAKING[ -]CHANGE: /m.test(message),
  );
  const feature = messages.some((message) => /^feat(?:\([^\r\n)]+\))?: /m.test(message));
  return breaking
    ? `${parts[0] + 1}.0.0`
    : feature
      ? `${parts[0]}.${parts[1] + 1}.0`
      : `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

/** Apply validated `version` to the build checkout, including both workspace packages and Cargo.lock. */
export function applyVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error('Invalid release version');
  for (const path of ['package.json', 'src-tauri/tauri.conf.json']) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    data.version = version;
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  }
  for (const path of ['src-tauri/Cargo.toml', 'crates/quickload-core/Cargo.toml']) {
    const source = readFileSync(path, 'utf8');
    writeFileSync(path, source.replace(/^version = "[^"]+"$/m, `version = "${version}"`));
  }
  const lock = readFileSync('Cargo.lock', 'utf8');
  writeFileSync(
    'Cargo.lock',
    lock.replace(
      /(\[\[package\]\]\r?\nname = "quickload(?:-core)?"\r?\nversion = ")[^"]+/g,
      `$1${version}`,
    ),
  );
}

/** Execute a read-only Git command using argument arrays and return trimmed UTF-8 output. */
function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Determine an idempotent release plan from reachable stable tags, or apply a supplied build version. */
function main() {
  if (process.argv[2] === 'apply') {
    applyVersion(process.argv[3]);
    return;
  }
  const tags = git('tag', '--merged', 'HEAD', '--sort=-version:refname')
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const previous = tags[0];
  const released = previous && git('rev-list', '-n', '1', previous) === git('rev-parse', 'HEAD');
  const messages = git('log', '--format=%B%x00', previous ? `${previous}..HEAD` : 'HEAD').split(
    '\0',
  );
  const version = released
    ? previous.slice(1)
    : previous
      ? nextVersion(previous.slice(1), messages)
      : JSON.parse(readFileSync('package.json', 'utf8')).version;
  const output = `version=${version}\ntag=v${version}\nrelease=${!released}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
