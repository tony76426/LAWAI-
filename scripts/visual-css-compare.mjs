/**
 * Compare the pre-optimization homepage against the optimized branch at
 * identical viewport sizes, same local assets, same Chromium instance.
 * Remote services/fonts are intentionally blocked for deterministic geometry.
 */
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { mkdir, writeFile } from 'node:fs/promises';

const originalUrl = 'http://127.0.0.1:8765/index.html';
const optimizedUrl = 'http://127.0.0.1:8766/index.html';
const sizes = [360, 390, 430, 768, 1024, 1440, 1920];
const selectors = [
  'body',
  'header.lawai-premium-header',
  'header.lawai-premium-header .logo-container',
  'header.lawai-premium-header .nav-cluster',
  'header.lawai-premium-header .lawai-mh-btn',
  'main#main-content > .u-inline-0006:first-child',
  'main#main-content > .u-inline-0006:first-child img.u-inline-0007',
  '.hero-section',
  '.hero-bg',
  '.hero-title',
  '.hero-subtitle',
  '.main-ai-btn',
  '.lawai-glass-features .features-grid',
  '.lawai-glass-features .feature-card',
  '.lawai-premium-section',
  '.nav-galaxy',
  '.lawai-mh-drawer',
  '.line-float-btn'
];
const properties = [
  'display','position','visibility','opacity','width','height',
  'min-width','max-width','min-height','max-height','font-family',
  'font-size','font-weight','line-height','letter-spacing','color',
  'background-color','background-image','background-position',
  'background-size','border-radius','border-width','box-shadow',
  'margin','padding','gap','grid-template-columns','transform',
  'top','right','bottom','left','z-index','object-fit','object-position'
];
const normalize = (value) => String(value).replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://LOCAL').trim();

async function takeSnapshot(browser, url, width, label) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    const resource = new URL(route.request().url());
    if (resource.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  if (!response?.ok()) throw Error(label + ': homepage HTTP error ' + response?.status());
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(img =>
      img.complete ? Promise.resolve() : new Promise(resolve => {
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',resolve,{once:true});
      })
    ));
  });
  await page.addStyleTag({content:
    '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'
  });
  await page.waitForTimeout(300);
  const measurements = await page.evaluate(({selectors,properties}) => {
    const output = {};
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (!node) {output[selector] = null; continue;}
      const computed = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const styles = {};
      for (const p of properties) styles[p] = computed.getPropertyValue(p);
      output[selector] = {
        rect: { x:rect.x, y:rect.y, width:rect.width, height:rect.height },
        styles
      };
    }
    return output;
  }, {selectors,properties});
  const screenshot = await page.screenshot({animations:'disabled',caret:'hide',fullPage:false});
  await writeFile('css-visual-artifacts/'+label+'-'+width+'.png', screenshot);
  await context.close();
  return {measurements, screenshot};
}
function compareImages(a,b,width) {
  const x=PNG.sync.read(a), y=PNG.sync.read(b);
  if(x.width!==y.width||x.height!==y.height)throw Error(width+': screenshot size changed');
  let mismatched=0;
  for(let i=0;i<x.data.length;i+=4){
    if(Math.abs(x.data[i]-y.data[i])>4||
       Math.abs(x.data[i+1]-y.data[i+1])>4||
       Math.abs(x.data[i+2]-y.data[i+2])>4) mismatched++;
  }
  const ratio=mismatched/(x.width*x.height);
  return {mismatched,ratio};
}
await mkdir('css-visual-artifacts',{recursive:true});
const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',
  args:['--no-sandbox','--disable-dev-shm-usage']
});
let failures=0;
try {
  for(const width of sizes){
    const a=await takeSnapshot(browser,originalUrl,width,'before');
    const b=await takeSnapshot(browser,optimizedUrl,width,'after');
    let different=[];
    for(const sel of selectors){
      const u=a.measurements[sel],v=b.measurements[sel];
      if(!u||!v){if(u!==v)different.push(sel+': visibility or markup difference');continue;}
      for(const key of ['x','y','width','height']){
        if(Math.abs(u.rect[key]-v.rect[key])>0.6)different.push(sel+' rect.'+key+' '+u.rect[key]+'→'+v.rect[key]);
      }
      for(const property of properties){
        if(normalize(u.styles[property])!==normalize(v.styles[property]))
          different.push(sel+' '+property+' '+u.styles[property]+'→'+v.styles[property]);
      }
    }
    const pixels=compareImages(a.screenshot,b.screenshot,width);
    console.log(width+'px: computed/style differences '+different.length+
                ', screenshot mismatch '+(pixels.ratio*100).toFixed(3)+'%');
    if(different.length)console.error(different.slice(0,20).join('\n'));
    // Screenshots include dynamic third-party fallbacks; tolerate tiny raster differences,
    // but not any target layout or CSS computed-style changes.
    if(different.length || pixels.ratio>0.01)failures++;
  }
} finally {
  await browser.close();
}
if(failures)throw Error(failures+' responsive viewport(s) failed visual regression.');
console.log('All seven responsive CSS comparisons passed.');
