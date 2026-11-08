/* LawAI 法詢：單檔、離線可用的 A4 PDF 直接下載工具 (V2.9)。
 * 不使用第三方遠端服務，不上傳案件內容，不呼叫列印對話框。
 * 使用 Canvas 繪製中文報告後，直接組裝 JPEG 頁面 PDF。
 * PDF 採圖片式頁面：可查看、下載與列印；文字不可直接選取。
 */
(function (root) {
  'use strict';
  const W = 1240, H = 1754, PADDING = 80, BOTTOM = 107;
  const NAVY='#173959', TEXT='#26384c', MID='#55728d', PALE='#e8f1fb', LINE='#d8e3ee', GOLD='#c9a260';
  const FONT_SERIF='"Noto Serif TC","Noto Serif CJK TC","PMingLiU",serif';
  const FONT_SANS='"Noto Sans TC","Noto Sans CJK TC","Microsoft JhengHei",sans-serif';
  const encoder=new TextEncoder();
  const cleanse = str=>String(str||'').replace(/[\u0000-\u0008\u000b-\u001f]/g,'').trim();

  function collectParagraphs(node) {
    if (!node) return [];
    const entries=Array.from(node.querySelectorAll('p,li'));
    if (entries.length) return entries.map(x=>cleanse(x.textContent)).filter(Boolean);
    return cleanse(node.textContent).split(/\n+/).map(cleanse).filter(Boolean);
  }
  function readReport(report) {
    const out=[];
    for(const section of report.querySelectorAll('.report-section')) {
      const heading=cleanse(section.querySelector('.report-section-title')?.textContent);
      const rows=[];
      const body=section.querySelector('.report-section-body');
      if(!body)continue;
      const actionRows=Array.from(body.querySelectorAll('.report-action'));
      if(actionRows.length) {
        for(const action of actionRows) {
          const title=cleanse(action.querySelector('strong')?.textContent);
          const detail=action.querySelector('.report-action-description') || action;
          const blocks=collectParagraphs(detail);
          if (!title && !blocks.length)continue;
          rows.push({type:'number',number:cleanse(action.querySelector('.report-action-num')?.textContent),title,blocks});
        }
      } else if(body.querySelector('.report-evidence-item')) {
        const items=Array.from(body.querySelectorAll('.report-evidence-item')).map(el=>cleanse(el.querySelector('span:last-child')?.textContent)).filter(Boolean);
        items.forEach(t=>rows.push({type:'check',title:'',blocks:[t]}));
      } else {
        collectParagraphs(body).forEach(t=>rows.push({type:'plain',title:'',blocks:[t]}));
      }
      // 法條索引與必要來源警語不應在 PDF 匯出時被漏掉。
      const citations=body.querySelector('.report-law-index,.report-source-hint');
      if(citations)rows.push({type:'hint',title:'法條核對',blocks:[cleanse(citations.innerText||citations.textContent)]});
      const evidenceNote=body.querySelector('.report-evidence-note');
      if(evidenceNote) rows.push({type:'hint',title:'提醒',blocks:[cleanse(evidenceNote.textContent)]});
      out.push({heading,rows});
    }
    return {title:'線上生成式法律意見書',sub:'依據使用者提供的資訊，整理法律問題、分析方向及建議行動。',sections:out,
      disclaimer:cleanse(report.querySelector('.report-disclaimer')?.textContent)};
  }
  function makeCanvas(){const c=document.createElement('canvas');c.width=W;c.height=H;return c;}
  function rgbImagePdf(canvases) {
    // 用 Uint8Array 計算真實 byte offsets，避免中文標頭或 JPEG 位元組破壞 xref。
    const all=[], offsets=[0];let pos=0;
    function write(bytes){if(typeof bytes==='string')bytes=encoder.encode(bytes);all.push(bytes);pos+=bytes.length;}
    function obj(n,body){offsets[n]=pos;write(n+' 0 obj\n');write(body);write('\nendobj\n');}
    write('%PDF-1.4\n%\xC3\xA2\xC3\xA3\xC3\x8F\xC3\x93\n');
    const kids=canvases.map((_,i)=>String(3+i*3)+' 0 R').join(' ');
    obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
    obj(2,`<< /Type /Pages /Kids [${kids}] /Count ${canvases.length} >>`);
    canvases.forEach((c,i)=>{
      const p=3+i*3, content=p+1, image=p+2;
      obj(p,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
      const commands='q 595.28 0 0 841.89 0 0 cm /Im0 Do Q\n';
      obj(content,`<< /Length ${encoder.encode(commands).length} >>\nstream\n${commands}endstream`);
      const b64=c.toDataURL('image/jpeg',0.91).split(',')[1], raw=atob(b64), data=new Uint8Array(raw.length);
      for(let k=0;k<raw.length;k++)data[k]=raw.charCodeAt(k);
      offsets[image]=pos;
      write(image+' 0 obj\n');
      write(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`);
      write(data);write('\nendstream\nendobj\n');
    });
    const start=pos;
    write(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for(let i=1;i<offsets.length;i++)write(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
    write(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    return new Blob(all,{type:'application/pdf'});
  }
  function draw(data) {
    const canvases=[];
    let canvas,ctx,y=0,pageNumber=0;
    function startPage(){
      canvas=makeCanvas();ctx=canvas.getContext('2d',{alpha:false});
      ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
      canvases.push(canvas);pageNumber++;
      ctx.fillStyle=NAVY;ctx.fillRect(PADDING,55,6,26);
      ctx.font=`600 23px ${FONT_SANS}`;ctx.fillText('LawAI 法詢',PADDING+18,77);
      ctx.strokeStyle=LINE;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(PADDING,96);ctx.lineTo(W-PADDING,96);ctx.stroke();
      ctx.fillStyle='#8190a3';ctx.font=`21px ${FONT_SANS}`;ctx.fillText(`第 ${pageNumber} 頁`,W-PADDING-70,H-50);
      y=125;
    }
    function ensure(amount){if(y+amount>H-BOTTOM) startPage();}
    function font(size,bold=false,serif=true){ctx.font=`${bold?'700':'400'} ${size}px ${serif?FONT_SERIF:FONT_SANS}`;}
    function lineWrap(str,maxWidth,size,bold=false,serif=true){
      font(size,bold,serif);const lines=[];
      for(const part of cleanse(str).split(/\n/)){
        if(!part){lines.push('');continue;}
        let line='';
        for(const ch of Array.from(part)){
          const trial=line+ch;
          if(line && ctx.measureText(trial).width>maxWidth){lines.push(line);line=ch;}
          else line=trial;
        }
        if(line)lines.push(line);
      }
      return lines;
    }
    function paragraph(str,x,maxWidth,size=26,lineHeight=43,color=TEXT){
      const lines=lineWrap(str,maxWidth,size,false,true);
      font(size,false,true);ctx.fillStyle=color;
      for(const line of lines){ensure(lineHeight);ctx.fillText(line,x,y+size);y+=lineHeight;}
      return lines.length;
    }
    startPage();
    ensure(230);
    y+=40;ctx.fillStyle=NAVY;ctx.font=`700 50px ${FONT_SERIF}`;ctx.textAlign='center';ctx.fillText(data.title,W/2,y+48);ctx.textAlign='left';
    y+=98;ctx.fillStyle=GOLD;ctx.fillRect(W/2-120,y,240,3);y+=35;
    const subtitle=lineWrap(data.sub,W-2*PADDING,24,false,true);
    font(24,false,true);ctx.fillStyle=MID;ctx.textAlign='center';
    for(const line of subtitle){ctx.fillText(line,W/2,y+22);y+=37;}
    ctx.textAlign='left';y+=36;
    data.sections.forEach((section,idx)=>{
      ensure(155);
      ctx.fillStyle=PALE;ctx.fillRect(PADDING,y,W-2*PADDING,66);
      ctx.fillStyle=NAVY;ctx.font=`700 35px ${FONT_SERIF}`;
      ctx.fillText(section.heading||`${idx+1}、法律分析`,PADDING+21,y+46);
      y+=89;
      section.rows.forEach((row,index)=>{
        const labelSize=26, textSize=25, lineHeight=43;
        const titleX=PADDING+70, bodyX=PADDING+251;
        const titleWidth=bodyX-titleX-18;
        const blocks=(row.blocks||[]).filter(Boolean);
        // 先處理一行標題與至少一行正文；不足時另開新頁。
        ensure(96);
        const top=y;
        if(row.type==='number') {
          ctx.fillStyle='#3d729d';ctx.beginPath();ctx.arc(PADDING+24,y+24,23,0,Math.PI*2);ctx.fill();
          ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font=`700 25px ${FONT_SANS}`;ctx.fillText(row.number||String(index+1),PADDING+24,y+32);ctx.textAlign='left';
          ctx.fillStyle=NAVY;ctx.font=`700 ${labelSize}px ${FONT_SERIF}`;
          const titleLines=lineWrap(row.title,titleWidth,labelSize,true,true);
          titleLines.forEach((t,i)=>ctx.fillText(t,titleX,y+29+i*38));
        } else if(row.type==='check'){
          ctx.fillStyle='#2d759d';ctx.font=`700 28px ${FONT_SANS}`;ctx.fillText('✓',PADDING+9,y+29);
        } else if(row.type==='hint') {
          ctx.fillStyle=MID;ctx.font=`700 24px ${FONT_SANS}`;ctx.fillText(row.title,PADDING+9,y+28);
        }
        const xx=row.type==='number'?bodyX:row.type==='check'?PADDING+60:PADDING+160;
        const mw=W-PADDING-xx;
        for(let bi=0;bi<blocks.length;bi++) {
          if(bi>0)y+=5;
          const prefix=blocks[bi].startsWith('•')?'': '';
          const lines=lineWrap(prefix+blocks[bi],mw,textSize,false,true);
          font(textSize,false,true);ctx.fillStyle=TEXT;
          for(const line of lines){
            ensure(lineHeight);
            ctx.fillText(line,xx,y+28);
            y+=lineHeight;
          }
        }
        y=Math.max(y,top+55)+14;
        ensure(18);
        ctx.strokeStyle=LINE;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(PADDING,y);ctx.lineTo(W-PADDING,y);ctx.stroke();y+=15;
      });
      y+=23;
    });
    if(data.disclaimer){ensure(150);ctx.fillStyle='#eef2f6';ctx.fillRect(PADDING,y,W-PADDING*2,4);y+=22;
      const text=data.disclaimer.length>280?data.disclaimer.slice(0,280)+'…':data.disclaimer;
      paragraph(text,PADDING+6,W-PADDING*2-12,20,33,MID);
    }
    return canvases;
  }
  let busy=false;
  async function save(report) {
    if(busy)return false;
    if(!report||!report.querySelector('.law-report'))throw new Error('尚未產生完整法律意見書');
    busy=true;
    try{
      if(document.fonts?.ready)await Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,3000))]);
      const data=readReport(report);
      if(!data.sections.length)throw new Error('無法辨識法律意見書章節');
      const pages=draw(data);
      const file=rgbImagePdf(pages);
      if(file.size<1000)throw new Error('產生的 PDF 檔案大小異常');
      const url=URL.createObjectURL(file);
      const a=document.createElement('a');a.href=url;a.download='LawAI_法律意見書.pdf';a.style.display='none';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      return true;
    }finally{busy=false;}
  }
  root.LawAIStandalonePdf=Object.freeze({save,readReport,version:'2.9'});
})(window);
