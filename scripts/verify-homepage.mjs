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

// Resolve exact same-origin stylesheet URLs, including noscript fallbacks.
const cssPaths = assets.filter(path => path.endsWith('.css'));
function stylesheetURLs(html, pageURL = origin + '/') {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => {
    const attrs = Object.fromEntries([...tag.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map(([, name, double, single]) => [name.toLowerCase(), double ?? single]));
    if (!attrs.href || !attrs.rel?.toLowerCase().split(/\s+/).includes('stylesheet')) return null;
    return new URL(attrs.href.replace(/&amp;|&#0*38;|&#x0*26;/gi, '&'), pageURL);
  }).filter(Boolean);
  const result = new Map();
  for (const path of cssPaths) {
    const matches = links.filter(url => url.pathname === path);
    assert.equal(matches.length, path === '/lawai_contral.min.css' ? 1 : 2,
      'Missing or duplicate stylesheet/fallback: ' + path);
    for (const url of matches) {
      assert.equal(url.origin, origin, 'Stylesheet must be same-origin: ' + path);
      assert.ok(url.search.length > 1, 'Homepage must use versioned stylesheet: ' + path);
      url.hash = '';
      assert.equal(url.href, matches[0].href, 'Stylesheet fallback version differs: ' + path);
    }
    result.set(path, matches[0].href);
  }
  for (const url of links) {
    if (url.origin === origin) assert.ok(result.has(url.pathname), 'Untracked local stylesheet: ' + url.pathname);
  }
  return result;
}

function checkMarkup(html) {
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
const localCSS = stylesheetURLs(home);
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
      if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + url.pathname + url.search);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('Empty production response: ' + url.pathname + url.search);
      return { bytes, type: response.headers.get('content-type') || '', url: response.url || url.href };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await pause(2000 * attempt);
    }
  }
  throw lastError;
}

const indexResponse = await fetchBytes('/');
assert.match(indexResponse.type, /text\/html/i, 'Homepage content-type unexpected');
const publishedHome = indexResponse.bytes.toString('utf8');
checkMarkup(publishedHome);
const publishedCSS = stylesheetURLs(publishedHome, indexResponse.url);
for (const path of cssPaths) {
  assert.equal(publishedCSS.get(path), localCSS.get(path), 'Published homepage references a different CSS version: ' + path);
}
const criticalHeader = html => html.match(/<style id="lawai-header-critical-20261119">([\s\S]*?)<\/style>/)?.[1];
assert.ok(criticalHeader(home), 'Local critical header missing');
assert.equal(criticalHeader(publishedHome)?.trim(), criticalHeader(home).trim(), 'Published critical header differs from candidate');
console.log('PASS: published homepage markup and responsive LCP priorities');

for (const path of assets) {
  const requestURL = publishedCSS.get(path) || path;
  const result = await fetchBytes(requestURL);
  const expectedType = path.endsWith('.css') ? /text\/css/i :
    path.endsWith('.js') ? /javascript/i :
    path.endsWith('.webp') ? /image\/webp/i :
    path.endsWith('.png') ? /image\/png/i : /json/i;
  assert.match(result.type, expectedType, 'Wrong content type for ' + requestURL);
  if (cssPaths.includes(path)) {
    assert.equal(result.url, requestURL, 'Unexpected stylesheet redirect: ' + requestURL);
    assert.equal(sha(result.bytes), sha(read(path.slice(1))),
      'Published CSS does not match GitHub working copy at ' + requestURL + ' (deployment or CDN cache may be stale)');
  }
  console.log('PASS: ' + requestURL + ' (' + result.bytes.length + ' bytes)');
}
for (const path of pages) {
  const result = await fetchBytes(encodeURI(path));
  assert.match(result.type, /text\/html/i, 'Expected HTML page: ' + path);
  console.log('PASS: ' + path);
}
console.log('PASS: production CSS integrity, first-screen resources and five primary destinations');
