/**
 * Maintain homepage CSS without editing generated minified CSS or inline header twice.
 * Run: node scripts/build-homepage-css.mjs
 * Verify: node scripts/build-homepage-css.mjs --check
 * Only homepage assets are touched; no GitHub/API access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const check = process.argv.includes('--check');
const result = spawnSync(process.execPath, [path.join(dir, 'scripts/build-css.mjs'), ...(check ? ['--check'] : [])], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const srcPath=path.join(dir,'lawai_home_header.css');
const indexPath=path.join(dir,'index.html');
const header=fs.readFileSync(srcPath,'utf8').trim();
const page=fs.readFileSync(indexPath,'utf8');
const pattern=/(<style id="lawai-header-critical-20261119">)[\s\S]*?(<\/style>)/;
if(!pattern.test(page))throw Error('Critical-header style not found in index.html');
const newPage=page.replace(pattern,(_full,start,end)=>start+'\n'+header+'\n'+end);
if(check){
  if(newPage!==page){
    console.error('Generated CSS / inline header is out of sync. Run node scripts/build-homepage-css.mjs');
    process.exitCode=1;
  }else console.log('PASS: CSS and homepage inline header are synchronized.');
}else{
  fs.writeFileSync(indexPath,newPage);
  console.log('Regenerated lawai_contral.min.css and homepage critical header.');
}
