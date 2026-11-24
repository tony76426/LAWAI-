import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const query = '?v=20261123-cssopt1&mode=test';
const markup = '<link rel="stylesheet" href="lawai_contral.min.css?v=20261123-cssopt1&amp;mode=test">' +
  '<link rel="preload" as="image" href="/assets/images/lawai-main.webp" imagesrcset="test" fetchpriority="high">' +
  '<img class="u-inline-0007" loading="eager" fetchpriority="high">' +
  'lawai-mh-btn lawai-mh-drawer nav-galaxy line-float-btn';
const assets = [
  'lawai_contral.min.css', 'lawai_feature_glass.css', 'lawai_footer_premium.css',
  'lawai_header_scroll.js', 'lawai_runtime.js',
  'assets/images/lawai-main-640.webp', 'assets/images/lawai-main-1280.webp',
  'assets/images/lawai-main.webp', 'assets/images/lawai-legal-office-hero-banner-960.webp',
  'assets/images/lawai-legal-office-hero-banner-1920.webp', 'homelogo.png', 'manifest.json',
];
const mock = [
  'const scenario = process.env.LAWAI_TEST_SCENARIO;',
  'const markup = ' + JSON.stringify(markup) + ';',
  'globalThis.fetch = async input => {',
  '  if (scenario === "local") throw Error("Local validation must not use the network");',
  '  const url = new URL(input);',
  '  console.log("MOCK GET " + url.pathname + url.search);',
  '  const p = url.pathname;',
  '  let body = "body{color:red}", type = "text/css";',
  '  if (p === "/") {',
  '    body = scenario === "old-version" ? markup.replace("20261123-cssopt1", "old") : markup;',
  '    type = "text/html";',
  '  } else if (p === "/lawai_contral.min.css") {',
  '    if (url.search && scenario === "stale") body = "body{color:blue}";',
  '    if (url.search && scenario === "wrong-type") type = "text/html";',
  '  } else if (p.endsWith(".js")) type = "application/javascript";',
  '  else if (p.endsWith(".webp")) type = "image/webp";',
  '  else if (p.endsWith(".png")) type = "image/png";',
  '  else if (p.endsWith(".json")) type = "application/json";',
  '  else if (p.endsWith(".html")) type = "text/html";',
  '  return new Response(body, {headers: {"content-type": type}});',
  '};',
].join('\n');

function run(scenario, html = markup) {
  const root = mkdtempSync(join(tmpdir(), 'lawai-homepage-test-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(new URL('./verify-homepage.mjs', import.meta.url), join(root, 'scripts/verify-homepage.mjs'));
    writeFileSync(join(root, 'index.html'), html);
    for (const asset of assets) {
      mkdirSync(dirname(join(root, asset)), { recursive: true });
      writeFileSync(join(root, asset), 'body{color:red}');
    }
    const preload = join(root, 'mock-fetch.mjs');
    writeFileSync(preload, mock);
    const result = spawnSync(process.execPath, [
      '--import', preload, join(root, 'scripts/verify-homepage.mjs'),
      ...(scenario === 'local' ? [] : ['--production']),
    ], { encoding: 'utf8', env: { ...process.env, LAWAI_TEST_SCENARIO: scenario }, timeout: 30000 });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test('local candidate validates without a production request', () => {
  const result = run('local');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /MOCK GET/);
});
test('published exact query is fetched, including HTML-escaped separator', () => {
  const result = run('healthy');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('MOCK GET /lawai_contral.min.css' + query));
  assert.ok(!result.stdout.split('\n').includes('MOCK GET /lawai_contral.min.css'));
});
test('stale versioned CSS fails even when unversioned CSS would match', () => {
  const result = run('stale');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Published minified CSS does not match/);
});
test('wrong MIME at the versioned URL fails', () => {
  const result = run('wrong-type');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Wrong content type/);
});
test('stale homepage CSS version fails even if bytes match', () => {
  const result = run('old-version');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different CSS version/);
});
test('unversioned stylesheet link fails local validation', () => {
  const result = run('local', markup.replace('lawai_contral.min.css?v=20261123-cssopt1&amp;mode=test', 'lawai_contral.min.css'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /versioned generated stylesheet/);
});
