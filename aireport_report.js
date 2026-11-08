/* LawAI 法詢 — 法律意見書 V2.9 專用呈現模組。
 * 相容既有 /aireport/api/opinion 之文字回傳；不得虛構法條、判決、勝訴機率。
 * 所有 AI/使用者輸入皆經過 HTML escaping；報告僅在完成諮詢後顯示。
 */
(function (root) {
  'use strict';
  const NUMS = ['一', '二', '三', '四'];
  const TITLES = ['案件摘要', '法律分析與判斷', '建議行動方案', '蒐證與佐證資料'];
  const NO_DATA = '目前生成內容尚未提供此項具體資料，建議於正式採取法律行動前，再確認相關事實及證據。';
  const h = (str) => String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tidy = (str) => String(str == null ? '' : str).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim();
  const plain = (str) => tidy(str).replace(/^\s*#{1,5}\s*/gm, '').replace(/\*\*|__/g, '').replace(/`/g, '');
  const cap = (str, limit) => str.length <= limit ? str : str.slice(0, limit - 1) + '…';

  const ICON_PATHS = Object.freeze({
    balance: '<path d="M12 3v18M5 21h14M4 7h16M12 3 4 7M12 3l8 4M4 7l-3 6h6l-3-6ZM20 7l-3 6h6l-3-6Z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 15h8M8 18h5"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 6 10 8 10-8"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.8 9A7 7 0 0 1 18 6l2 1M4 17l2 1a7 7 0 0 0 12.2-3"/>'
  });
  function icon(name) {
    const inner = ICON_PATHS[name] || ICON_PATHS.check;
    return `<svg class="report-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  }

  function headingInfo(line) {
    const match = plain(line).trim().match(/^([一二三四五])\s*[、.．）)]\s*(.{2,160})$/);
    if (!match) return null;
    const rest = match[2].trim();
    const colon = rest.search(/[：:]/);
    const title = (colon >= 0 ? rest.slice(0, colon) : rest).trim();
    const inline = colon >= 0 ? rest.slice(colon + 1).trim() : '';
    if (title.length >= 35) return null;
    // 同時兼容後端既有五章輸出（第三章風險評估）與新版四章輸出。
    // 依章名判定，而非按原始序號硬切：第三章風險直接排除，不顯示，也不併入其他章。
    let index = null;
    if (/風險|勝訴|勝算|機率/.test(title)) index = -1;
    else if (/案件|摘要|事實|概述/.test(title)) index = 0;
    else if (/法律|法條|分析|判斷|權利|責任/.test(title)) index = 1;
    else if (/蒐證|搜證|收證|證據|舉證|佐證|資料準備/.test(title)) index = 3;
    else if (/行動|建議|處理|對策|方案|後續措施/.test(title)) index = 2;
    return index === null ? null : {index, inline};
  }

  function parseSections(source) {
    const text = tidy(source).replace(/^```(?:text|markdown)?\s*\n/i, '').replace(/\n```\s*$/, '');
    const result = ['', '', '', ''];
    let active = null;
    const preface = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      const heading = headingInfo(line);
      if (heading) {
        active = heading.index;
        if (active >= 0 && heading.inline) result[active] += heading.inline + '\n';
        continue;
      }
      if (active !== null) {
        if (active >= 0) result[active] += raw + '\n';
      } else if (line && !/^(?:【?法律意見書】?|線上生成式法律意見書|AI\s*法律意見書)$/.test(line)) {
        preface.push(raw);
      }
    }
    if (!result.some(x => x.trim())) result[1] = text;
    else if (preface.length) result[0] = preface.join('\n') + '\n' + result[0];
    return result.map(x => plain(x).trim());
  }

  function subparts(text) {
    const out = [];
    let label = '';
    let buffer = [];
    function flush() { if (buffer.join('\n').trim()) out.push({ label, text: buffer.join('\n').trim() }); buffer = []; }
    for (const line of tidy(text).split('\n')) {
      const m = line.trim().match(/^(適用法條|法律依據|法條依據|實務見解|實務理解|法院見解|初步判斷|分析結論|有利因素|不利因素|主要風險|影響評估|案件類型|主要事實|爭議焦點|待確認事項)\s*[：:]\s*(.*)$/);
      if (m) { flush(); label = m[1]; if (m[2]) buffer.push(m[2]); }
      else buffer.push(line);
    }
    flush();
    return out;
  }

  function blocks(text) {
    const src = plain(text).trim();
    if (!src) return `<p class="report-empty">${h(NO_DATA)}</p>`;
    const lines = src.split('\n').map(s => s.trim()).filter(Boolean);
    let result = '', list = [];
    function flush() { if (list.length) { result += '<ul class="report-bullets">' + list.map(s => `<li>${h(s)}</li>`).join('') + '</ul>'; list = []; } }
    for (const line of lines) {
      const listMatch = line.match(/^(?:[-•●▪]|\d+[.、)）]|[①②③④⑤⑥])\s*(.+)$/);
      if (listMatch) list.push(listMatch[1]);
      else { flush(); result += `<p>${h(line)}</p>`; }
    }
    flush();
    return result;
  }

  function row(label, content) {
    return `<div class="report-detail-row"><div class="report-row-label">${h(label)}</div><div class="report-row-content">${blocks(content)}</div></div>`;
  }

  function sectionsFromText(source) {
    let data;
    try { data = JSON.parse(source); } catch (_) {}
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const keys = [
        ['summary', 'caseSummary', 'case_summary'],
        ['legalAnalysis', 'legal_analysis', 'analysis'],
        ['actionPlan', 'action_plan', 'recommendations'],
        ['evidence', 'evidenceChecklist', 'evidence_checklist']
      ];
      const stringify = v => typeof v === 'string' ? v : Array.isArray(v) ? v.map(x => typeof x === 'string' ? '• ' + x : JSON.stringify(x)).join('\n') : v && typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}：${String(x)}`).join('\n') : '';
      const selected = keys.map(group => stringify(group.map(k => data[k]).find(v => v != null)));
      if (selected.some(Boolean)) return selected;
    }
    return parseSections(source);
  }

  /* V2.7：將原始摘要依原有語意分組；保留來源文字，不補造案情。 */
  function splitSummary(text, context) {
    const content = plain(text || context.initialQuestion || '');
    const raw = content.split('\n').map(x => x.trim()).filter(Boolean);
    const items = [];
    const heading = /^(案件類型|案件分類|案件背景|主要事實|事實摘要|事件經過|事發經過|爭議焦點|爭議重點|目前狀況|現況|待確認事項|待釐清事項|後續疑問|核心問題)\s*[：:]\s*(.*)$/;
    const numbered = /^(?:\d{1,2}[.、)）]|[一二三四][、.．])\s*(.+)$/;
    for (const line of raw) {
      const m = line.match(heading);
      const n = line.match(numbered);
      if (m) items.push({ label: m[1], text: m[2] });
      else if (n) items.push({ label: '', text: n[1] });
      else if (items.length && line.length < 36 && !/[。！？；]$/.test(line)) items[items.length - 1].text += ' ' + line;
      else items.push({ label:'', text:line });
    }
    // 後端如僅輸出一大段，按完整句號切為最多四項；不要生造新事實。
    let guard = 0;
    while (items.length < 4 && guard++ < 8) {
      let pick = -1, max = 0, split = null;
      items.forEach((item, i) => {
        const sentences = (item.text.match(/[^。！？；]+[。！？；]?/g) || []).map(x => x.trim()).filter(Boolean);
        if (sentences.length > 1 && item.text.length > max) { pick=i; max=item.text.length; split=sentences; }
      });
      if (pick < 0) break;
      const item = items[pick];
      const cut = Math.max(1, Math.floor(split.length / 2));
      items.splice(pick,1,{label:item.label,text:split.slice(0,cut).join('')},{label:'',text:split.slice(cut).join('')});
    }
    if (items.length > 4) {
      const overflow=items.splice(3);
      items.push({label:overflow[0].label,text:overflow.map(x=>x.text).join('\n')});
    }
    const defaultTitles=['案件背景','事件經過','目前狀況','爭議重點'];
    const titleMap={
      '案件類型':'案件背景','案件分類':'案件背景','案件背景':'案件背景',
      '主要事實':'事件經過','事實摘要':'事件經過','事件經過':'事件經過','事發經過':'事件經過',
      '爭議焦點':'爭議重點','爭議重點':'爭議重點','目前狀況':'目前狀況','現況':'目前狀況',
      '待確認事項':'待釐清事項','待釐清事項':'待釐清事項','後續疑問':'後續疑問','核心問題':'核心問題'
    };
    return items.filter(x=>x.text.trim()).map((item,i)=>({title:titleMap[item.label]||defaultTitles[i]||'補充說明',text:item.text}));
  }

  function numberedRows(items, extraClass) {
    return `<div class="report-actions ${extraClass}">${items.map((item,i)=>`<div class="report-action"><span class="report-action-num" aria-hidden="true">${i+1}</span><strong>${h(item.title)}</strong><div class="report-action-description">${blocks(item.text)}</div></div>`).join('')}</div>`;
  }

  function summaryHTML(text, context) {
    const entries=splitSummary(text,context);
    return entries.length ? numberedRows(entries,'report-summary-list') : blocks(NO_DATA);
  }

  function legalHTML(text) {
    if (!text || !plain(text)) return numberedRows([
      {title:'有利論述',text:'目前尚缺可核實的法律分析內容，不能據此確認對哪一方有利。'},
      {title:'待釐清問題',text:'應進一步核對案件事實、證據及適用法規。'}
    ],'report-legal-points');
    const parts=subparts(text);
    const supporting=[]; const uncertain=[];
    const caution=/(尚未|尚待|待確認|待釐清|仍需|需要再|須進一步|無法確認|難以確認|不確定|資料不足|證據不足|欠缺|未檢索|未查核|尚不|無從|未進行|不提供|仍有爭議)/;
    const uncertainLabel=/(待確認|待釐清|不利|風險|影響評估|疑點|未明|不確定)/;
    const pieces=parts.length?parts:[{label:'',text:plain(text)}];
    for (const part of pieces) {
      // 逐句區分；只有原文已指出限制，才歸入「不確定」。
      const sentences=(part.text.match(/[^。！？；\n]+[。！？；]?/g)||[]).map(x=>x.trim()).filter(Boolean);
      for (const sentence of sentences) {
        if (uncertainLabel.test(part.label) || caution.test(sentence)) uncertain.push(sentence);
        else supporting.push(sentence);
      }
    }
    const list=[
      {title:'有利論述',text:supporting.join('\n') || '目前資料尚不足以確認明確有利因素，應先核對法律依據與支持主張的證據。'},
      {title:'待釐清問題',text:uncertain.join('\n') || '現有分析未明確列出待釐清事項；仍應由專業人員確認相關事實、證據及法律適用。'}
    ];
    return numberedRows(list,'report-legal-points')+lawCitations(text);
  }

  function lawCitations(text) {
    // 僅從 AI 已提到的條文抽取索引；不自行推斷條文一定適用。
    const refs = [...new Set((plain(text).match(/(?:民法|刑法|刑事訴訟法|民事訴訟法|勞動基準法|消費者保護法|公寓大廈管理條例|公司法|個人資料保護法|土地法|建築法|家事事件法)\s*第\s*[0-9０-９]+(?:\s*[-之]\s*[0-9０-９]+)?\s*條/g) || []).map(x => x.replace(/\s+/g, '')))].slice(0, 12);
    return refs.length ? `<div class="report-law-index"><span>文中提及條文（請核對現行法規）</span><div>${refs.map(x => `<span class="report-law-tag">${h(x)}</span>`).join('')}</div><a href="https://law.moj.gov.tw/" target="_blank" rel="noopener noreferrer">至全國法規資料庫查核條文 ↗</a></div>` : `<div class="report-source-hint">正式採取法律行動前，仍須核對法條現行內容及裁判來源。</div>`;
  }

  function listItems(text) {
    const src = plain(text).trim();
    if (!src) return [];
    let arr = src.split(/\n+/).map(s => s.replace(/^\s*(?:[-•●▪]|\d+[.、)）]|[①②③④⑤⑥])\s*/, '').trim()).filter(Boolean);
    if (arr.length === 1 && arr[0].length > 120) {
      arr = arr[0].split(/(?<=。)\s*/).map(x => x.trim()).filter(Boolean);
    }
    return arr.slice(0, 24);
  }

  function actionHTML(text) {
    const items = listItems(text);
    if (!items.length) return blocks('');
    const labels = ['立即措施', '整理證據', '協調處理', '法律程序'];
    return `<div class="report-actions">${items.map((item, i) => {
      const m = item.match(/^(.{2,9})[：:]\s*(.+)$/);
      const label = m ? m[1] : (labels[i] || '後續建議');
      const detail = m ? m[2] : item;
      return `<div class="report-action"><span class="report-action-num">${i+1}</span><strong>${h(label)}</strong><p>${h(detail)}</p></div>`;
    }).join('')}</div>`;
  }

  function evidenceHTML(text) {
    const items = listItems(text);
    if (!items.length) return blocks('');
    return `<div class="report-evidence-grid">${items.map(item => `<div class="report-evidence-item"><span class="report-check-icon" aria-hidden="true">${icon("check")}</span><span>${h(item)}</span></div>`).join('')}</div><p class="report-evidence-note">以上為建議核對或蒐集的資料，不代表您已持有或已完成蒐證。</p>`;
  }

  function render(source, context) {
    const sections = sectionsFromText(tidy(source));
    const body = [
      summaryHTML(sections[0], context || {}),
      legalHTML(sections[1]),
      actionHTML(sections[2]),
      evidenceHTML(sections[3])
    ];
    return `<article class="law-report" lang="zh-Hant" aria-label="AI 生成法律意見書">
      <header class="report-cover">
        <span class="report-decoration" aria-hidden="true">✦</span>
        <div class="report-cover-kicker">LawAI 法詢・法律分析報告</div>
        <div class="report-cover-title-wrap"><h2>線上生成式法律意見書</h2><span class="report-cover-balance" aria-hidden="true">${icon("balance")}</span></div>
        <div class="report-gold-rule"></div>
        <p class="report-cover-subtitle">不需要懂法律，我們會協助整理重點、評估方向，<br class="report-desktop-only">最後再判斷是否需要正式法律行動。</p>
        <div class="report-promises"><span><span class="report-promise-check" aria-hidden="true">${icon("check")}</span>不需法律背景</span><span><span class="report-promise-check" aria-hidden="true">${icon("check")}</span>清楚掌握案件重點</span><span><span class="report-promise-check" aria-hidden="true">${icon("check")}</span>提供初步建議方向</span></div>
      </header>
      ${body.map((content, i) => `<section class="opinion-section report-section report-section-${i+1}" aria-labelledby="report-title-${i+1}"><h3 id="report-title-${i+1}" class="report-section-title">${NUMS[i]}、${TITLES[i]}</h3><div class="report-section-body">${content}</div></section>`).join('')}
      <footer class="report-disclaimer"><span class="report-shield-icon" aria-hidden="true">${icon("shield")}</span><p>本報告由 AI 依使用者提供之資料自動整理，僅供初步理解法律問題，不構成律師正式法律意見；法條、裁判及具體行動仍應確認其正確性與適用性。</p></footer>
    </article>`;
  }

  root.LawAIReport = Object.freeze({ render, icon, parseSections, sectionsFromText, plainText: source => tidy(source), version: '2.9' });
})(window);
