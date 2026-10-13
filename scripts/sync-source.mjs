/** Fetch the authoritative public snapshot, verify it, and update only source files. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';

const repo = process.env.PUBLIC_REPOSITORY;
const repositories = ['sdk-js', 'maps', 'examples', 'store-locator', 'route-planner', 'trail-explorer', 'property-explorer', 'field-operations', 'geodata-explorer'];
if (!repositories.includes(repo)) throw new Error(`Set PUBLIC_REPOSITORY to one of ${repositories.join(', ')}`);
const base = 'https://cdn.unmap.dev/open-source/';
const manifestResponse = await fetch(base + 'manifest.json', { signal: AbortSignal.timeout(30000), cache: 'no-store' });
if (!manifestResponse.ok) throw new Error(`Source manifest returned ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
const snapshot = manifest.schema === 1 && manifest.repositories?.[repo];
if (!snapshot || !/^[a-f0-9]{64}$/.test(snapshot.sha256) || snapshot.file !== `${repo}/${snapshot.sha256}.tar.gz`) {
  throw new Error('Unexpected source manifest');
}
const response = await fetch(base + snapshot.file, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Source archive returned ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length > 10 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== snapshot.sha256) {
  throw new Error('Source archive failed its size or SHA-256 check');
}
const stage = mkdtempSync(join(tmpdir(), 'unmap-public-sync-'));
try {
  const archive = join(stage, 'source.tar.gz');
  const source = join(stage, 'source');
  writeFileSync(archive, bytes);
  mkdirSync(source);
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (!entries.length || entries.some((name) => name.startsWith('/') || name.split('/').some((part) => ['..', '.git', 'node_modules'].includes(part)))) {
    throw new Error('Unsafe archive paths');
  }
  // The publisher packs regular files only. Refuse links before extracting anything.
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split('\n');
  if (listing.some((line) => !line.startsWith('-'))) throw new Error('Archive contains a non-regular file');
  execFileSync('tar', ['-xzf', archive, '-C', source]);
  const root = process.cwd();
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(relative(source, path));
      else throw new Error('Unexpected extracted file');
    }
  }
  visit(source);
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  // GitHub's repository token cannot change workflow definitions. Keep that trust boundary
  // explicit: workflow changes require a maintainer commit before a new snapshot can sync.
  for (const file of new Set([...files, ...tracked].filter((name) => name.startsWith('.github/')))) {
    if (!files.includes(file) || !tracked.includes(file) || !readFileSync(join(source, file)).equals(readFileSync(join(root, file)))) {
      throw new Error(`A maintainer must update ${file} before syncing this snapshot`);
    }
  }
  for (const file of tracked) {
    if (!files.includes(file)) rmSync(join(root, file));
  }
  for (const file of files) {
    const target = resolve(root, file);
    if (!target.startsWith(root + '/')) throw new Error('Unsafe destination');
    // Refuse a symlink in an existing checkout path too.
    for (let path = target; path !== root; path = dirname(path)) {
      try { if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink in checkout: ${file}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(source, file)));
  }
  console.log(`Verified ${repo} source snapshot ${snapshot.sha256}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
