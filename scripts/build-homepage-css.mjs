/**
 * Maintain homepage CSS without editing generated minified CSS or inline header twice.
 * Run: node scripts/build-homepage-css.mjs
 * Verify: node scripts/build-homepage-css.mjs --check
 * Only homepage assets are touched; no GitHub/API access.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function minifyCss(src){
 let out='',pendingSpace=false,quote='',comment=false;
 for(let i=0;i<src.length;i++){
   const ch=src[i],next=src[i+1];
   if(comment){if(ch==='*'&&next==='/'){comment=false;i++}continue;}
   if(quote){out+=ch;if(ch==='\\'){out+=src[++i]||'';continue;}if(ch===quote)quote='';continue;}
   if(ch==='/'&&next==='*'){
     if(src[i+2]==='!'){const end=src.indexOf('*/',i+2);if(end<0)throw Error('unclosed license');out+=src.slice(i,end+2);i=end+1;continue;}
     comment=true;i++;continue;
   }
   if(ch==='\''||ch==='"'){if(pendingSpace&&out&&!/[{};,]/.test(out.at(-1)))out+=' ';pendingSpace=false;quote=ch;out+=ch;continue;}
   if(/\s/.test(ch)){pendingSpace=true;continue;}
   if(pendingSpace){if(out&&!/[{};,]/.test(out.at(-1))&&!/[{};,]/.test(ch))out+=' ';pendingSpace=false;}
   if(/[{};,]/.test(ch)&&out.endsWith(' '))out=out.slice(0,-1);
   out+=ch;
 }
 return out.trim()+'\n';
}
const main=fs.readFileSync(path.join(dir,'lawai_contral.css'),'utf8');
const compiled=minifyCss(main);
const cssPath=path.join(dir,'lawai_contral.min.css');
const srcPath=path.join(dir,'lawai_home_header.css');
const indexPath=path.join(dir,'index.html');
const header=fs.readFileSync(srcPath,'utf8').trim();
const page=fs.readFileSync(indexPath,'utf8');
const pattern=/(<style id="lawai-header-critical-20261119">)[\s\S]*?(<\/style>)/;
if(!pattern.test(page))throw Error('Critical-header style not found in index.html');
const newPage=page.replace(pattern,(_full,start,end)=>start+'\n'+header+'\n'+end);
if(process.argv.includes('--check')){
  const existing=fs.readFileSync(cssPath,'utf8');
  if(existing!==compiled||newPage!==page){
    console.error('Generated CSS / inline header is out of sync. Run node scripts/build-homepage-css.mjs');
    process.exitCode=1;
  }else console.log('PASS: CSS and homepage inline header are synchronized.');
}else{
  fs.writeFileSync(cssPath,compiled);
  fs.writeFileSync(indexPath,newPage);
  console.log('Regenerated lawai_contral.min.css and homepage critical header.');
}
