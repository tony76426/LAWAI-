/**
 * LawAI homepage read-only acceptance checks.
 * Local:      node scripts/verify-homepage.mjs
 * Production: node scripts/verify-homepage.mjs --production
 * No writes, API calls or form submissions to the production website.
 */
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--production');
const origin = 'https://www.lawfavor.com';
const read = file => readFileSync(resolve(root, file));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const home = read('index.html').toString('utf8');

const assets = [
  '/lawai_contral.min.css',
  '/lawai_feature_glass.css',
  '/lawai_footer_premium.css',
  '/lawai_header_scroll.js',
  '/lawai_runtime.js',
  '/assets/images/lawai-main-640.webp',
  '/assets/images/lawai-main-1280.webp',
  '/assets/images/lawai-main.webp',
  '/assets/images/lawai-legal-office-hero-banner-960.webp',
  '/assets/images/lawai-legal-office-hero-banner-1920.webp',
  '/homelogo.png',
  '/manifest.json',
];
const pages = [
  '/airobot.html', '/aireport.html', '/lawmap.html',
  '/lawreserve.html', '/任務輸入頁版面.html',
];

function checkMarkup(html) {
  assert.match(html, /<link\b[^>]*href="lawai_contral\.min\.css\?[^"]+"[^>]*rel="stylesheet"/, 'Homepage must use versioned generated stylesheet');
  const imagePreloads = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(m => m[0]).filter(tag => tag.includes('rel="preload"') && tag.includes('as="image"'));
  assert.equal(imagePreloads.length, 1, 'Homepage must prioritize exactly one image preload');
  assert.ok(imagePreloads[0].includes('/assets/images/lawai-main.webp'), 'Primary image preload missing');
  assert.ok(imagePreloads[0].includes('imagesrcset='), 'Responsive LCP preload srcset missing');
  assert.ok(imagePreloads[0].includes('fetchpriority="high"'), 'LCP preload not high priority');
  assert.ok(!imagePreloads.some(tag => tag.includes('legal-office-hero')), 'Do not high-priority preload below-fold background');
  const heroImage = html.match(/<img\b[^>]*class="u-inline-0007"[^>]*>/)?.[0];
  assert.ok(heroImage, 'Primary LCP image not found');
  assert.ok(heroImage.includes('loading="eager"') && heroImage.includes('fetchpriority="high"'), 'Primary image priority missing');
  for (const selector of ['lawai-mh-btn', 'lawai-mh-drawer', 'nav-galaxy', 'line-float-btn']) {
    assert.ok(html.includes(selector), 'Expected homepage navigation/CTA missing: ' + selector);
  }
}

checkMarkup(home);
for (const path of assets) {
  const local = path.slice(1);
  assert.ok(statSync(resolve(root, local)).size > 0, 'Missing or empty local asset: ' + local);
}
console.log('PASS: local LCP hints, HTML entrypoints and ' + assets.length + ' static assets');
if (!live) process.exit(0);

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchBytes(path, attempts = 3) {
  const url = new URL(path, origin);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'LawAI-Homepage-Verification/1.0', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(25000),
        redirect: 'follow',
      });
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url.pathname);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Empty production response: ' + url.pathname);
      return { bytes, type: response.headers.get('content-type') || '' };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(2000 * attempt);
    }
  }
  throw lastError;
}

const indexResponse = await fetchBytes('/?lawai_audit=1');
assert.match(indexResponse.type, /text\/html/i, 'Homepage content-type unexpected');
checkMarkup(indexResponse.bytes.toString('utf8'));
console.log('PASS: published homepage markup and responsive LCP priorities');

for (const path of assets) {
  const result = await fetchBytes(path);
  const expectedType = path.endsWith('.css') ? /text\/css/i :
    path.endsWith('.js') ? /javascript/i :
    path.endsWith('.webp') ? /image\/webp/i :
    path.endsWith('.png') ? /image\/png/i : /json/i;
  assert.match(result.type, expectedType, 'Wrong content type for ' + path);
  if (path === '/lawai_contral.min.css') {
    assert.equal(sha(result.bytes), sha(read('lawai_contral.min.css')),
      'Published minified CSS does not match GitHub working copy (deployment or CDN cache may be stale)');
  }
  console.log('PASS: ' + path + ' (' + result.bytes.length + ' bytes)');
}
for (const path of pages) {
  const result = await fetchBytes(encodeURI(path));
  assert.match(result.type, /text\/html/i, 'Expected HTML page: ' + path);
  console.log('PASS: ' + path);
}
console.log('PASS: production CSS integrity, first-screen resources and five primary destinations');
