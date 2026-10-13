import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const publicKeys = ['HONGSI_API_URL', 'HONGSI_REPO_URL', 'HONGSI_SUPPORT_URL', 'HONGSI_DEMO_URL', 'HONGSI_CLASSROOM_URL'];
const local = (() => {
  try { return parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error('.env 파일을 읽을 수 없어요.');
  }
})();

export function required(name) {
  const value = Object.hasOwn(process.env, name) ? process.env[name] : local[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} 값을 설정해 주세요.`);
  return value.trim();
}

function urlValue(name) {
  const value = required(name).replace(/\/+$/, '');
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} 주소 형식을 확인해 주세요.`); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || /[\s<>"'`\\]/.test(value)) {
    throw new Error(`${name} 주소 형식을 확인해 주세요.`);
  }
  return value;
}

export function repositoryName() {
  const url = new URL(urlValue('HONGSI_REPO_URL'));
  const name = url.pathname.slice(1);
  if (url.origin !== 'https://github.com' || name.endsWith('.git') || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error('HONGSI_REPO_URL에 GitHub 저장소 페이지 주소를 설정해 주세요.');
  }
  return name;
}

export function publicUrls() {
  const values = Object.fromEntries(publicKeys.map(key => [key, urlValue(key)]));
  repositoryName();
  return values;
}

export function webhookConfig() {
  const repository = required('DEMO_REPOSITORY');
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository) || repository.endsWith('.git')) {
    throw new Error('DEMO_REPOSITORY에 소유자/저장소 형식으로 설정해 주세요.');
  }
  return { secret: required('UPSTREAM_WEBHOOK_SECRET'), token: required('GITHUB_DISPATCH_TOKEN'), repository, upstream: repositoryName() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--check-build') throw new Error('--check-build 옵션이 필요해요.');
    publicUrls();
    console.log('데모 빌드 주소 설정을 확인했어요.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : '데모 빌드 설정을 확인해 주세요.');
    process.exitCode = 1;
  }
}
