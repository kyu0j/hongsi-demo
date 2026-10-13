import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, readdirSync, existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { repositoryName } from '../config/env.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = join(root, 'upstream.json');
const repository = `https://github.com/${repositoryName()}.git`;
const branch = 'main';
const fixed = ['README.md', 'RELEASE_NOTES.md', 'LICENSE', 'app/index.html', 'app/tsconfig.json', 'app/svelte.config.js', 'app/pnpm-lock.yaml'];
const trees = ['app/src', 'app/public', 'docs'];
const owned = (path) => fixed.includes(path) || path === 'app/package.json' || trees.some(tree => path.startsWith(`${tree}/`));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const write = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
function walk(path, base = root) {
  if (!lstatSync(join(base, path)).isDirectory()) throw new Error(`허용하지 않는 원본 폴더: ${path}`);
  return readdirSync(join(base, path), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${path}/${entry.name}`, base) : [`${path}/${entry.name}`]);
}
function verify(manifest) {
  if (!/^[a-f0-9]{64}$/.test(manifest.repositoryHash ?? '') || manifest.branch !== branch || !/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error('upstream.json의 원본 정보가 올바르지 않습니다.');
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!owned(path) || path.includes('..') || digest(readFileSync(join(root, path))) !== hash) throw new Error(`원본 파일이 변경되었습니다: ${path}. 데모 코드는 app/demo에서 수정해 주세요.`);
  }
  for (const tree of trees.filter(tree => existsSync(join(root, tree)))) for (const path of walk(tree)) if (!(path in manifest.files)) throw new Error(`원본 폴더에 추가된 파일이 있습니다: ${path}`);
}
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const { values: options } = parseArgs({ options: { check: { type: 'boolean' }, source: { type: 'string' }, 'working-tree': { type: 'boolean' } } });
if (options.check && options.source) throw new Error('--check와 --source는 함께 사용할 수 없습니다.');
if (options['working-tree'] && (!options.source || options.check)) throw new Error('--working-tree는 --source와 함께 사용해 주세요.');
if (options.check) {
  if (!previous) throw new Error('먼저 npm run sync를 실행해 주세요.');
  verify(previous);
  if (previous.repositoryHash !== digest(repository.toLowerCase())) throw new Error('원본 저장소 설정이 변경되었습니다. npm run sync를 실행해 주세요.');
  console.log(`원본 일치 확인: ${previous.commit}`);
} else {
  if (previous) verify(previous);
  const temp = options.source ? null : mkdtempSync(join(tmpdir(), 'hongsi-upstream-'));
  const source = options.source ? resolve(options.source) : temp;
  try {
    if (temp) {
      git(temp, 'init', '--quiet');
      git(temp, 'fetch', '--quiet', '--depth=1', repository, `refs/heads/${branch}`);
    }
    const commit = git(source, 'rev-parse', options.source ? `refs/heads/${branch}` : 'FETCH_HEAD').toString().trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('원본 커밋을 확인하지 못했습니다.');
    const files = new Map();
    if (options['working-tree']) {
      if (git(source, 'branch', '--show-current').toString().trim() !== branch) throw new Error('로컬 main 브랜치에서 실행해 주세요.');
      for (const path of [...fixed, 'app/package.json', ...trees.flatMap(tree => walk(tree, source))]) {
        if (!owned(path) || path.includes('..') || !lstatSync(join(source, path)).isFile()) throw new Error(`허용하지 않는 원본 파일: ${path}`);
        files.set(path, readFileSync(join(source, path)));
      }
    } else {
      const entries = git(source, 'ls-tree', '-rz', '--full-tree', commit, '--', ...fixed, ...trees, 'app/package.json').toString().split('\0').filter(Boolean);
      for (const entry of entries) {
        const [meta, path] = entry.split('\t');
        if (!owned(path) || path.includes('..') || !/^100(644|755) blob /.test(meta)) throw new Error(`허용하지 않는 원본 파일: ${path}`);
        files.set(path, git(source, 'show', `${commit}:${path}`));
      }
    }
    for (const path of [...fixed, 'app/package.json', 'app/src/main.ts']) if (!files.has(path)) throw new Error(`필수 원본 파일 누락: ${path}`);
    if (!files.get('app/index.html').toString().includes('src="/src/main.ts"')) throw new Error('원본 시작 경로가 바뀌었습니다. 데모 진입점을 확인해 주세요.');
    const pkg = JSON.parse(files.get('app/package.json'));
    pkg.name = 'hongsi-demo-app';
    pkg.engines = { ...pkg.engines, node: '24.x' };
    pkg.scripts = { dev: 'vite --port 5174', check: 'svelte-check --tsconfig ./tsconfig.demo.json', build: 'vite build', preview: 'vite preview --host 127.0.0.1 --port 5274' };
    files.set('app/package.json', Buffer.from(`${JSON.stringify(pkg, null, 2)}\n`));
    for (const tree of trees) rmSync(join(root, tree), { recursive: true, force: true });
    for (const [path, bytes] of files) write(path, bytes);
    write('upstream.json', `${JSON.stringify({ repositoryHash: digest(repository.toLowerCase()), branch, commit, ...(options['working-tree'] ? { workingTree: true } : {}), files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, bytes]) => [path, digest(bytes)])) }, null, 2)}\n`);
    console.log(`원본 동기화: ${commit} (${files.size}개 파일)`);
  } finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
}
