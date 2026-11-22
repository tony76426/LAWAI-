/** Build the unchanged-order production CSS from the maintainable source.
 * Run: node scripts/build-css.mjs
 * CI:  node scripts/build-css.mjs --check
 * No third-party dependencies; quoted CSS values and calc() whitespace are preserved.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function minifyCss(src){
 let out="",pendingSpace=false,quote="",comment=false;
 for(let i=0;i<src.length;i++){
   const ch=src[i],next=src[i+1];
   if(comment){if(ch==="*"&&next==="/"){comment=false;i++}continue;}
   if(quote){out+=ch;if(ch==="\\"){out+=src[++i]||"";continue;}if(ch===quote)quote="";continue;}
   if(ch==="/"&&next==="*"){
     if(src[i+2]==="!"){const end=src.indexOf("*/",i+2);if(end===-1)throw new Error("Unclosed license comment");out+=src.slice(i,end+2);i=end+1;continue;}
     comment=true;i++;continue;
   }
   if(ch==="'"||ch==='"'){if(pendingSpace&&out&&!/[{};,]/.test(out.at(-1)))out+=" ";pendingSpace=false;quote=ch;out+=ch;continue;}
   if(/\s/.test(ch)){pendingSpace=true;continue;}
   if(pendingSpace){if(out&&!/[{};,]/.test(out.at(-1))&&!/[{};,]/.test(ch))out+=" ";pendingSpace=false;}
   if(/[{};,]/.test(ch)&&out.endsWith(" "))out=out.slice(0,-1);
   out+=ch;
 }
 if(quote||comment)throw Error("CSS unterminated quote/comment");
 return out.trim();
}
const sourcePath=resolve(ROOT,"lawai_contral.css");
const outputPath=resolve(ROOT,"lawai_contral.min.css");
const generated=minifyCss(readFileSync(sourcePath,"utf8"))+"\n";
if(process.argv.includes("--check")){
  if(readFileSync(outputPath,"utf8")!==generated){
    console.error("lawai_contral.min.css is stale; run node scripts/build-css.mjs");
    process.exit(1);
  }
  console.log("LawAI minified CSS is current.");
}else{
  writeFileSync(outputPath,generated,"utf8");
  console.log("Generated lawai_contral.min.css");
}
