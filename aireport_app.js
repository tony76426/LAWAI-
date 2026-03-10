
    
let currentStep = -1;           // -1: initial input, 1-3: followup questions
let detectedCaseType = '';
let initialQuestionText = '';

let scenarioOptions = [];
let selectedScenario = '';
let customScenario = '';

let followups = [];            // [{ q: "...", options: ["...","...","..."] }, ...]
const answersMeta = [];        // [{ selectedIndex, selectedText, customText }, ...]
// === Helpers: ensure option text length (>= 25 chars) ===
function ensureMinLen(text, minLen = 25) {
  const s = (text || "").trim();
  return s;
}
// === Subtype scoring (resolve multi-hit conflicts) ===
// If a subtype has `match` and is hit, it will be considered.
// Optional fields:
// - score: base score when matched (default 1)
// - priority: tie-breaker (default 0)
// - keywords: [RegExp,...] for extra signals (each hit +1)
function scoreSubtype(st, hay){
  try{
    if (!st || !st.match || !st.match.test(hay)) return { ok:false, score:0, priority:0 };
    let score = (typeof st.score === "number" ? st.score : 1);
    const kws = Array.isArray(st.keywords) ? st.keywords : [];
    for (const kw of kws){
      try{ if (kw && kw.test && kw.test(hay)) score += 1; } catch(e){}
    }
    const priority = (typeof st.priority === "number" ? st.priority : 0);
    return { ok:true, score, priority };
  } catch(e){
    return { ok:false, score:0, priority:0 };
  }
}
function pickBestSubtype(subtypes, hay){
  if (!Array.isArray(subtypes) || !subtypes.length) return null;
  let best = null;
  let bestMeta = null;
  for (const st of subtypes){
    const meta = scoreSubtype(st, hay);
    if (!meta.ok) continue;
    if (!bestMeta || meta.score > bestMeta.score || (meta.score === bestMeta.score && meta.priority > bestMeta.priority)){
      best = st;
      bestMeta = meta;
    }
  }
  return best;
}

function ensureOptionsMinLen(arr, minLen = 25) {
  if (!Array.isArray(arr)) return [];
  return arr.map(t => ensureMinLen(t, minLen));
}

// === 嚴格檢查情境選項字數（80～100 字） ===
function cleanPunct(text) {
  if (!text) return "";
  return String(text)
    .replace(/，。/g, "。")
    .replace(/。。+/g, "。")
    .replace(/,,+/g, "，")
    .trim();
}


function enforceOptionLengths(arr, minLen = 80, maxLen = 100) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(raw => cleanPunct(String(raw || "").trim()))
    .filter(Boolean)
    .map(s => {
      let out = s;
      // 只做「清理／截斷」，不再自動補字
      if (out.length > maxLen) {
        out = out.slice(0, maxLen);
      }
      return cleanPunct(out);
    });
}


// === Lawyer-thinking layers (for UI color & summary) ===
// followup question index: 0=事實, 1=責任, 2=結論
function getLayerForFollowup(i){
  if (i === 0) return "fact";
  if (i === 1) return "resp";
  return "dmg";
}
function layerLabel(k){
  if (k === "fact") return "事實";
  if (k === "resp") return "責任";
  return "結論";
}

// === Case summary sentence (auto-generated) ===
function buildCaseSummary(){
  const parts = [];
  const cs = (selectedScenario || customScenario || "").trim();
  if (cs) parts.push(cs);

  // add 3 answers summary (picked first, then custom)
  for (let i = 0; i < followups.length; i++){
    const m = answersMeta[i] || {};
    const picked = (m.selectedText || "").trim();
    const custom = (m.customText || "").trim();

    const one = picked || custom;
    if (one) parts.push(one);
  }

  if (!parts.length) return "";

  // 一句話組合（避免太長：過長則截斷）
  let sentence = "本案初步情況概述為：" + parts.join("；") + "。";
  if (sentence.length > 180){
    sentence = sentence.slice(0, 176) + "…";
  }
  return cleanPunct(sentence);
}
function renderCaseSummary(){
  const panel = document.getElementById("caseSummaryPanel");
  const textEl = document.getElementById("caseSummaryText");
  // 關閉案件摘要提示面板：不再顯示，也不再帶入文字
  if (panel) panel.style.display = "none";
  if (textEl) textEl.innerText = "";
}


// persist meta for analytics
function persistMeta(){
  try{
    localStorage.setItem("lawai_answers_meta", JSON.stringify({
      ts: Date.now(),
      caseType: detectedCaseType,
      pickedTemplate: window.__pickedTemplate || "",
      legalPath: window.__legalPath || "",
      scenario: { selectedScenario, customScenario },
      answersMeta,
      followups
    }));
  }catch(e){}
}

function onCustomScenarioInput(){
  const cs = document.getElementById("customScenario");
  customScenario = (cs ? cs.value.trim() : "");
  // 若使用者開始補充，視覺上不強制清掉已選，但摘要會同步
  renderCaseSummary();
  persistMeta();
}
function onCustomAnswerInput(qIndex){
  const ta = document.getElementById("customAnswer");
  const custom = (ta ? ta.value.trim() : "");
  if (!answersMeta[qIndex]) answersMeta[qIndex] = { selectedIndex: -1, selectedText: "", customText: "", layer: getLayerForFollowup(qIndex) };
  answersMeta[qIndex].customText = custom;
  renderCaseSummary();
  persistMeta();
}

// === CaseType-based followup templates (3 questions × 3 options) ===
// 依案件類型（租賃/買賣/車禍）提供更像真人律師的追問選項。
// 若無法匹配，會退回使用 AI 生成。

// === Scenario assets (legal templates) ===
// 這裡把「情境聚焦 + 三題追問」變成可重用的法律資料資產（不依賴 AI 也能跑）。
// - base: 各案件類型的預設三題
// - subtypes: 依輸入關鍵字切換到更精準的子類模板（更像真人律師問法）

/*
============================================================
LawAI 情境式資產（Scenario Assets）擴充藍圖：33 類 → 100 類
------------------------------------------------------------
目標：
- 讓「情境聚焦 + 三題追問」在更多案件類型下可直接套用本地模板
- 每類固定 3 題追問 × 每題 3 個選項（選項至少 25 字），並支援後端統計

資產分層：
A. 核心大類（既有 33 類）
   - 買賣、租賃、車禍、借貸、詐欺、勞資、離婚、遺產…等
B. 子題延伸（新增 67 類，本版已內建，合計 100 類）
   - 租賃子題：租金爭議 / 押金返還 / 修繕責任 / 提前解約
   - 消費子題：網購糾紛 / 消費退費 / 健身房退費 / 補習班退費 / 旅遊契約
   - 不動產子題：占用排除 / 通行權 / 鄰損 / 違建 / 公寓大廈 / 管委會爭議 / 土地界址
   - 程序子題：支付命令 / 假扣押 / 假處分 / 保全證據 / 強制執行異議…等
   - 家事/繼承子題：剩餘財產分配 / 探視權 / 遺囑 / 特留分 / 遺產分割 / 遺產管理人…等
   - 刑事子題：侵占 / 竊盜 / 恐嚇（可持續擴充更多刑事類別）

維護方式：
1) 想新增第 101 類：
   - 在 LAWAI_SCENARIO_ASSETS 新增一個 key（例如 "妨害秩序"）
   - 填入 base[3]：每題 options[3]（至少 25 字；不足會自動補字）
2) 想讓模型輸入更容易命中：
   - 在 normalizeCaseTypeKey() 增加對應的關鍵字正則，回傳同名 key
============================================================
*/

// 已改為全面由 AI 動態生成情境與追問，原本的本地情境資產已移除以簡化維護。
const LAWAI_SCENARIO_ASSETS = {};




function normalizeCaseTypeKey(caseType){
  const s = String(caseType || "").trim();
  if (!s) return "";
  // 先容錯：把相近描述歸類到資產 key（可持續擴充）
  if (/(車禍|交通事故|肇事|碰撞|追撞|擦撞|行車事故)/.test(s)) return "車禍";
  if (/(租賃|租屋|房租|承租|押金|房東|租約|退租)/.test(s)) return "租賃";
  if (/(買賣|購屋|交屋|房屋買賣|中古屋|瑕疵|漏水|仲介|房屋瑕疵)/.test(s)) return "買賣";
  if (/(借貸|借款|借錢|欠款|借據|本息|還款)/.test(s)) return "借貸";
  if (/(詐欺|被騙|騙局|投資詐騙|代購詐騙|釣魚|人頭帳戶)/.test(s)) return "詐欺";
  if (/(毒品|毒|安非他命|海洛因|K他命|K他|ketamine|大麻|MDMA|搖頭丸|喵喵|咖啡包|依托咪酯|冰毒|驗尿|尿液|勒戒|戒治|戒癮|緩起訴.*治療)/i.test(s)) return "毒品";
  if (/(侵權|結論賠償|侵害權利|不當行為|車損以外結論)/.test(s)) return "侵權";
  if (/(名譽|毀謗|誹謗|公然侮辱|抹黑|爆料)/.test(s)) return "名譽毀損";
  if (/(個資|個人資料|外洩|洩漏|個資法|資料被用|盜用資料)/.test(s)) return "個資";
  if (/(勞資|勞動|欠薪|加班|資遣|解僱|離職|勞基法)/.test(s)) return "勞資";
  if (/(職災|職業災害|工傷|職務受傷|通勤職災)/.test(s)) return "職災";
  if (/(侵害配偶權|配偶權|精神賠償.*外遇|外遇.*精神賠償)/.test(s)) return "侵害配偶權";
  if (/(離婚|分居|夫妻|婚姻|外遇|婚姻破裂)/.test(s)) return "離婚";
  if (/(監護|監護權|親權|主要照顧|探視|扶養照顧)/.test(s)) return "監護權";
  if (/(扶養費|子女扶養|生活費分擔|撫養費)/.test(s)) return "扶養費";
  if (/(保護令|家暴|家庭暴力|暴力|威脅|恐嚇配偶|同居暴力)/.test(s)) return "保護令";
  if (/(遺產|繼承|遺囑|特留分|繼承人|遺產分配)/.test(s)) return "遺產";
  if (/(工程|承攬|裝修|工程款|尾款|追加款|驗收|瑕疵修補)/.test(s)) return "工程款";
  if (/(消費|退貨|退款|消保|商品瑕疵|延遲交付|履約爭議)/.test(s)) return "消費爭議";
  if (/(醫療|醫師|手術|診所|病歷|醫療疏失|併發症)/.test(s)) return "醫療糾紛";
  if (/(著作權|侵權轉載|抄襲|重製|公開傳輸|影片被用|圖片被用)/.test(s)) return "著作權";
  if (/(商標|仿冒|侵害商標|混淆|品牌被用|攀附)/.test(s)) return "商標";
  if (/(股權|股份|股東|公司法|出資|經營權|分紅|董事會)/.test(s)) return "公司股權";
  if (/(合夥|合作|分潤|退夥|結算|共同債務|夥伴)/.test(s)) return "合夥";
  if (/(票據|支票|本票|退票|跳票|背書)/.test(s)) return "票據";
  if (/(行政罰|罰鍰|裁罰|處分書|訴願|申復|行政處分)/.test(s)) return "行政罰";
  if (/(稅務|補稅|追稅|查核|稅單|營業稅|綜所稅|扣繳)/.test(s)) return "稅務";
  if (/(不動產|房地|土地|房屋|過戶|抵押|共有|占用)/.test(s)) return "不動產";
  if (/(分割共有|共有物分割|分割共有物)/.test(s)) return "分割共有物";
  if (/(借名登記|代持|人頭登記|掛名|名義人)/.test(s)) return "借名登記";
  if (/(保險|理賠|拒賠|減賠|保單|出險)/.test(s)) return "保險理賠";
  if (/(跟騷|騷擾|尾隨|糾纏|盯梢|持續聯絡)/.test(s)) return "跟騷";
  if (/(強制執行|執行|扣押|查封|支付命令|判決確定|調解筆錄)/.test(s)) return "強制執行";
  if (/(傷害|打人|互毆|毆打|驗傷|診斷證明)/.test(s)) return "刑事傷害";
  if (/(性侵|妨害性自主|猥褻|強制性交|性騷擾嚴重|不當性行為)/.test(s)) return "妨害性自主";

  
  // === 擴充：常見子題容錯（33 類 → 100 類）===
if (/(網購|電商|蝦皮|露天|momo|PChome|賣家不出貨|退貨|退款)/.test(s)) return "網購糾紛";
  if (/(退費|退款|解約退費|消費爭議|定型化契約)/.test(s)) return "消費退費";
  if (/(健身房|教練課|會籍|會員退費)/.test(s)) return "健身房退費";
  if (/(補習班|課程退費|補教|補課)/.test(s)) return "補習班退費";
  if (/(旅遊|旅行社|行程取消|退費爭議)/.test(s)) return "旅遊契約";
  if (/(醫美|美容|醫療糾紛|醫療過失|診所)/.test(s)) return "醫療過失";
  if (/(本票|裁定|本票裁定|票款)/.test(s)) return "本票裁定";
  if (/(假扣押|假處分|保全|保全程序)/.test(s)) return "保全程序";
  if (/(強制執行異議|執行異議|分配表|異議之訴)/.test(s)) return "強制執行異議";
  if (/(侵占|挪用)/.test(s)) return "侵占";
  if (/(竊盜|偷|失竊)/.test(s)) return "竊盜";
  if (/(恐嚇|勒索)/.test(s)) return "恐嚇";
  if (/(偽造|變造|偽造文書|私文書)/.test(s)) return "偽造文書";
// 若模型直接回傳已存在的 key，就原樣
  if (LAWAI_SCENARIO_ASSETS[s]) return s;
  return "";
}

const stepContainer = document.getElementById("step-container");

initFirstStep();

function initFirstStep() {
  currentStep = -1;
  detectedCaseType = '';
  initialQuestionText = '';
  scenarioOptions = [];
  selectedScenario = '';
  customScenario = '';
  followups = [];
  answersMeta.length = 0;
  window.__pickedTemplate = "";
  window.__legalPath = "";
  window.__forcedCaseType = "";
  renderCaseSummary();

  stepContainer.innerHTML = `
       <label style="color:var(--primary)">請描述您的法律問題（例如：我買的房子交屋後發現漏水）</label>
       <textarea id="initialQuestion" placeholder="請輸入" style="background:#ffffff;"></textarea>
       <div id="inputLiveHint" class="hint-mini" style="display:none; margin-top:10px; line-height:1.6;">我正在整理你的重點，等等會用幾個問題幫你釐清。</div>
       <div class="encouragement">✍️ 請盡量具體描述，有助於後續問答準確</div>

       <div class="buttons" style="margin-top:20px;">
         <button class="primary-cta" onclick="submitInitialQuestion()">
           <span class="material-icons cta-arrow">arrow_forward</span>
           <span>開始分析</span>
         </button>
       </div>
     `;
  setProgress(0, ""); // 0/4
  attachInitialTypingHint();
}

function setProgress(stepNum, text) {
  // stepNum: 0..3
  const pct = Math.max(0, Math.min(100, (stepNum / 3) * 100));const prog = document.getElementById("progress");
  if (prog) prog.style.width = pct + "%";
  const encour = document.getElementById("encouragement");
  if (encour) encour.innerText = text || "";
}


function hideHeroHighlights(){
  try{
    var h = document.querySelector('.hero-highlights');
    if (h) h.style.display = 'none';
  }catch(e){}
}

// === Low-interference instant feedback: show a soft hint after user starts typing ===
var __typingHintTimer = null;
function attachInitialTypingHint(){
  try {
    const inputEl = document.getElementById("initialQuestion");
    const hintEl = document.getElementById("inputLiveHint");
    if (!inputEl || !hintEl) return;

    // avoid duplicate bindings
    if (inputEl.__hintBound) return;
    inputEl.__hintBound = true;

    const handler = () => {
      const v = (inputEl.value || "").trim();
      if (!v){
        hintEl.style.display = "none";
        if (__typingHintTimer){ clearTimeout(__typingHintTimer); __typingHintTimer = null; }
        return;
      }
      if (__typingHintTimer){ clearTimeout(__typingHintTimer); }
      __typingHintTimer = setTimeout(() => {
        const vv = (inputEl.value || "").trim();
        hintEl.style.display = vv ? "block" : "none";
      }, 1200);
    };

    inputEl.addEventListener("input", handler);
    // init state
    handler();
  } catch (e) {
    console.warn("attachInitialTypingHint:", e);
  }
}


async function actuallySubmitInitialQuestion() {
  const inputEl = document.getElementById("initialQuestion");
  const input = (inputEl ? inputEl.value.trim() : "");
  if (!input) {
    alert("⚠️ 請輸入問題後再繼續！");
    return;
  }
  initialQuestionText = input;

  // ✅ 已完全取消「情境聚焦」：第一段輸入後直接進入三題釐清問題
  // 由第二階段原本的指令（confirmScenarioAndBuildFollowups）負責生成追問
  await confirmScenarioAndBuildFollowups(true);
}

function submitInitialQuestion() {
  const inputEl = document.getElementById("initialQuestion");
  const input = (inputEl ? inputEl.value.trim() : "");
  if (!input) {
    alert("⚠️ 請輸入問題後再繼續！");
    return;
  }
  // 顯示 LINE 綁定提醒，確保加入後再開始 AI 分析
  
if(window.__pendingOpinionGeneration){
  window.__pendingOpinionGeneration = false;
  continueGenerateOpinionAfterLine();
}else{
  actuallySubmitInitialQuestion();
}

}


function showLoading(message) {
  if (!stepContainer) return;

  // 讀秒規則：生成釐清問題 15 秒、生成法律意見書 18 秒；其他預設 8 秒
  let sec = 8;
  const msg = String(message || "");
  if (msg.includes("釐清問題")) {
    sec = 15;
  } else if (msg.includes("法律意見書")) {
    sec = 18;
  }

  // 清理舊的讀秒計時器（若有的話）
  try {
    if (window.__loadingCountdownTimer) {
      clearInterval(window.__loadingCountdownTimer);
      window.__loadingCountdownTimer = null;
    }
  } catch (e) {}

  stepContainer.innerHTML = `
    <div class="loading">
      <div class="loading-title">${escapeHtml(msg)}</div>
      <div class="loading-subtitle">
        為了讓後續建議更精準，正在整理你提供的重點。
      </div>
      <ul class="loading-steps">
        <li>① 讀取並理解你的敘述重點</li>
        <li>② 彙整需要確認的關鍵細節</li>
        <li>③ 生成下一步要回答的重點問題</li>
      </ul>
      <div id="loadingCountdown" class="loading-countdown" aria-live="polite"></div>
    </div>
  `;

  const countdownEl = document.getElementById("loadingCountdown");
  if (!countdownEl) return;

  function updateCountdown() {
    if (!countdownEl) return;
    if (sec > 0) {
      countdownEl.textContent = `約 ${sec} 秒內完成分析，請稍候…`;
      sec -= 1;
    } else {
      countdownEl.textContent = "快好了，正在為你整理內容…";
      try {
        if (window.__loadingCountdownTimer) {
          clearInterval(window.__loadingCountdownTimer);
          window.__loadingCountdownTimer = null;
        }
      } catch (e) {}
    }
  }

  updateCountdown();
  window.__loadingCountdownTimer = setInterval(updateCountdown, 1000);
}


function hideLoading() {
  // 用於「顯示 overlay 前」避免 loading 狀態卡死（例如：外遇/不忠多路徑選擇）
  // 只在目前畫面確實是 loading 時，才把 UI 恢復成「初始輸入」狀態；避免影響既有流程。
  try {
    if (!stepContainer) return;
    const isLoading = !!stepContainer.querySelector('.loading');
    if (!isLoading) return;

    stepContainer.innerHTML = `
      <label style="color:var(--primary)">請描述您的法律問題（例如：我買的房子交屋後發現漏水）</label>
      <textarea id="initialQuestion" placeholder="請輸入" style="background:#ffffff;"></textarea>
      <div class="encouragement">✍️ 請盡量具體描述，有助於後續問答準確</div>

      <div class="buttons" style="margin-top:20px;">
        <button onclick="submitInitialQuestion()">➡️ 開始分析</button>
      </div>
    `;
    const inputEl = document.getElementById("initialQuestion");
    if (inputEl && typeof initialQuestionText === "string") inputEl.value = initialQuestionText;
    setProgress(0, "");
    attachInitialTypingHint();
  } catch (e) {
    // 保底：不讓任何錯誤阻斷主流程
    console.warn("hideLoading fallback:", e);
  }
}

function showError(message) {
  stepContainer.innerHTML = `
    <div class="loading">${message}</div>
    <div class="buttons" style="margin-top:20px;">
      <button onclick="initFirstStep()">🔄 重新開始</button>
    </div>`;
}

function renderScenarioStep() {
  hideHeroHighlights();

  currentStep = 0;
  setProgress(1, "第 1 步／3：正在釐清案件核心，通常只需要幾秒鐘");

  const cards = (scenarioOptions.length ? scenarioOptions : ["（情境A）", "（情境B）", "（情境C）"])
    .map((s, idx) => `
      <button class="opt-btn layer-fact ${selectedScenario === s ? "selected" : ""}" onclick="pickScenario(${idx})">
        <div class="opt-inner">
          <div class="opt-badges">
            <span class="opt-badge fact">事實聚焦</span>
            <span class="opt-picked-tag"><span class="material-icons" style="font-size:16px;">check_circle</span>已選擇</span>
          </div>
          <div class="opt-text">${escapeHtml(s)}</div>
        </div>
      </button>
    `).join("");

  stepContainer.innerHTML = `
    <label>情境式聚焦</label>

    <div class="opt-custom">
      <div style="font-weight:700; color:var(--primary); margin:12px 0 8px;">
        下面選項會聚焦您的問題，若不符合，您可在這裡補充及修改（大致相符可略過）
      </div>
      <textarea id="customScenario" oninput="onCustomScenarioInput()" placeholder="請輸入"
        style="min-height:120px;">${escapeHtml(customScenario || "")}</textarea>
      <div class="hint-mini" style="margin-top:6px;">
        你可以只填寫上面的補充說明，或同時勾選底下情境，兩種方式都可以。
      </div>
    </div>

    <div class="opt-grid" id="scenarioGrid">
      ${cards}
    </div>

    <div style="margin-top:12px;font-size:13px;color:var(--text-muted);line-height:1.6;">
      ※ 以下內容為情境化示意，實際事實仍以你提供的案件經過為準。
    </div>

    <div class="buttons" style="margin-top:18px;">
      <button onclick="initFirstStep()">⬅️ 重新輸入</button>
      <button onclick="confirmScenarioAndBuildFollowups()">下一步</button>
    </div>
  `;
  renderCaseSummary();
  persistMeta();
}

function pickScenario(index){
  const s = scenarioOptions[index];
  selectedScenario = s;
  const cs = document.getElementById("customScenario");
  if (cs) cs.value = "";
  customScenario = "";
  // refresh selected style
  renderScenarioStep();
  renderCaseSummary();
  persistMeta();
}

async function confirmScenarioAndBuildFollowups(directFromInitial) {
  let chosen = "";
  if (directFromInitial) {
    // 直接用使用者第一段原始輸入當作「主要情境」占位，維持第二階段 prompt 不變
    chosen = (initialQuestionText || "").trim();
    customScenario = "";
  } else {
    const cs = document.getElementById("customScenario");
    customScenario = (cs ? cs.value.trim() : "");
    chosen = (selectedScenario || customScenario).trim();
  }
renderCaseSummary();
  persistMeta();
  if (!chosen) {
    alert("⚠️ 請先輸入問題後再繼續。");
    return;
  }

  // 改版說明：
  // 不再優先使用 LAWAI_SCENARIO_ASSETS 的本地模板，
  // 一律改由 AI 依照指令動態生成「3 題複合式追問＋情境式選項」，
  // 讓題目內容不受固定類型限制（可通用於各種案件）。

  showLoading("AI 正在生成 3 題釐清問題，請稍候...");
  try {
    const prompt = `你是一位熟悉台灣法律的「執業律師助理」。你的任務是像律師問話一樣，把事實問清楚，暫時不要下任何法律結論。

使用者已在前一階段確認，本案目前主要情境為：
「${chosen}」

使用者第一次原始描述如下：
「${initialQuestionText}」

使用者在第二次輸入框補充的內容如下（若有）：
「${customScenario || '（目前尚未補充額外說明）'}」

（案件類型僅供參考，不能被限制）
系統推測案件類型為：「${detectedCaseType || '尚未明確分類'}」

【你的任務】
請設計「3 組追問」，每一組必須包含：

一、主問題＋恰好兩個子問題（共 3 行）
第 1 行：本組要釐清的核心重點。
第 2 行：子問題（1）。
第 3 行：子問題（2）。
※ 子問題不得超過 2 題。

二、對應的 3 個情境式回答選項（皆為「第一人稱敘述句」，不能是問句）
1. 每個選項至少 80 字、最多 100 字，內容需具體描述實際行為、金額、時間區段、對象與目前處理情況。
2. 不得使用「通常」「一般來說」「很多人」「常見情況」等抽象概括語。
3. 不得加入使用者未提及的新情節（例如：新增原因、動機、場所或第三人）。
4. 三個選項之間必須呈現「不同的事實組合」或「不同的處理策略」，不可只改幾個字。

三、追問層次設定（請內化於問題設計中，不要明寫在文字裡）
第 1 組追問：偏重「事實釐清」，聚焦時間、地點、流程、金額與證據。
第 2 組追問：偏重「責任與風險」，釐清各方行為、約定內容與可能爭議點。
第 3 組追問：偏重「目前處理狀態與期待目標」，了解用戶目前已有的動作與真正想要的結果。

【禁止事項】
1. 不得出現具體日期或時間（例如「2023 年 5 月」「晚上 8 點」），如有需要僅可使用「之前」「近期」「這段時間」等相對描述。
2. 不得評論誰對誰錯，不得出現「應該勝訴」「法院會怎麼判」等字眼。
3. 不得指示具體行動（例如「你應該立刻提告」「你最好去報警」），只需把事實問清楚。
4. 不得使用「如果」「假設」自創情境，只能在使用者已提供的脈絡內延伸追問。

【輸出格式】
只輸出以下 JSON，不要加註解、不要加程式碼圍欄：

{
  "status": "法律問題",
  "questions": [
    { "q": "主問題＋兩個子問題（以換行分隔）", "options": ["選項1","選項2","選項3"] },
    { "q": "主問題＋兩個子問題（以換行分隔）", "options": ["選項1","選項2","選項3"] },
    { "q": "主問題＋兩個子問題（以換行分隔）", "options": ["選項1","選項2","選項3"] }
  ]
}
`;

    const res = await fetch("https://flask-law-ai.onrender.com/airobot/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      })
    });

    const data = await res.json();
    if (!data.choices || !data.choices[0]?.message?.content) {
      throw new Error("AI 回傳格式錯誤：" + JSON.stringify(data));
    }

    const content = data.choices[0].message.content.trim();
    let jsonText = content;

    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    if (!/^\s*[\{\[]/.test(jsonText)) {
      const start = jsonText.indexOf('{');
      const end = jsonText.lastIndexOf('}');
      if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
    }

    let payload;
    try { payload = JSON.parse(jsonText); }
    catch (e) {
      console.error("原始內容：", content);
      console.error("解析內容：", jsonText);
      throw new Error("AI 回傳非 JSON。");
    }

    if (payload.status === "法律問題" && Array.isArray(payload.questions) && payload.questions.length === 3) {
      followups = payload.questions.map(item => ({
        q: cleanPunct(String(item.q || "").trim()),
        options: enforceOptionLengths(Array.isArray(item.options) ? item.options.map(t => String(t || "").trim()) : [])
      }));

      // 初始化每題的 meta 狀態
      answersMeta.length = 0;
      for (let i = 0; i < followups.length; i++) {
        answersMeta.push({ selectedIndex: -1, selectedText: "", customText: "", layer: getLayerForFollowup(i) });
      }

      currentStep = 1;
      renderFollowupStep();
    } else {
      showError("AI 回傳格式異常，請重新嘗試。");
    }
  } catch (err) {
    showError("生成追問選項時發生錯誤，請重新嘗試。");
    console.error(err);
  }
}

function renderFollowupStep() {
  const idx = currentStep - 1; // 0..2
  const item = followups[idx] || { q: "", options: [] };
  const meta = answersMeta[idx] || { selectedIndex: -1, selectedText: "", customText: "", layer: getLayerForFollowup(idx) };

  setProgress(1 + idx, [
    "第 1 步／3：先把事實與背景問清楚（越具體越好）",
    "第 2 步／3：再確認責任歸屬與關鍵爭點",
    "第 3 步／3：最後補齊損害、證據與目前處理進度"
  ][idx] || "");
const opts = (item.options.length ? item.options : ["（選項1）","（選項2）","（選項3）"]).map((t, i) => {
    const selected = meta.selectedIndex === i;
    const layerKey = getLayerForFollowup(idx);
    const badgeClass = layerKey === "fact" ? "fact" : (layerKey === "resp" ? "resp" : "dmg");
    const badgeText = layerKey === "fact" ? "事實" : (layerKey === "resp" ? "責任" : "結論");
    return `<button class="opt-btn layer-${badgeClass} ${selected ? "selected" : ""}" onclick="pickFollowupOption(${idx}, ${i})">
      <div class="opt-inner">
        <div class="opt-badges">
          <span class="opt-badge ${badgeClass}">${badgeText}</span>
          <span class="opt-picked-tag"><span class="material-icons" style="font-size:16px;">check_circle</span>已選擇</span>
        </div>
        <div class="opt-text">${escapeHtml(t)}</div>
      </div>
    </button>`;
  }).join("");

  let navButtons = "";
  if (currentStep > 0) navButtons += `<button onclick="prevStep()">⬅️ 上一步</button>`;
  navButtons += `<button onclick="nextStep()">➡️ 下一步</button>`;

  stepContainer.innerHTML = `
    <label>第 ${idx + 1} 題（情境選項）</label>
    <div style="margin:4px 0 10px;">
      <span class="stage-chip ${getLayerForFollowup(idx)==="fact"?"fact":(getLayerForFollowup(idx)==="meta"?"meta":"logic")}">
        <span class="material-icons" style="font-size:18px;margin-right:4px;">account_tree</span>
        邏輯判斷層：${layerLabel(getLayerForFollowup(idx))}
      </span>
    </div>
    <p style="font-size:20px; font-weight:bold; color:var(--primary); margin:0 0 12px;">${escapeHtml(item.q)}</p>

    <div class="opt-custom">
      <div style="font-weight:700; color:var(--primary); margin:16px 0 8px;">
        先挑選下面最像你的情況，之後在這裡補充或更正情況。
      </div>
      <textarea
        id="customAnswer"
        oninput="onCustomAnswerInput(${idx})"
        placeholder="請輸入"
        style="min-height:140px;"
      >${escapeHtml(meta.customText || "")}</textarea>
      <div class="hint-mini">
        （你可以只輸入文字、只選情境，或兩者都填寫）
      </div>
    </div>

    <div class="opt-grid">
      ${opts}
    </div>

    <div class="buttons" style="margin-top:18px;">${navButtons}</div>
  `;
  renderCaseSummary();
  persistMeta();
}

function pickFollowupOption(qIndex, optIndex){
  const item = followups[qIndex];
  if (!item) return;
  const text = (item.options && item.options[optIndex]) ? item.options[optIndex] : "";
  answersMeta[qIndex] = answersMeta[qIndex] || { selectedIndex: -1, selectedText: "", customText: "", layer: getLayerForFollowup(idx) };
  answersMeta[qIndex].selectedIndex = optIndex;
  answersMeta[qIndex].selectedText = text;

  // rerender to show selected style
  renderFollowupStep();
  renderCaseSummary();
  persistMeta();
}

function nextStep() {
  // ✅ 已取消「情境聚焦」：不再存在 currentStep === 0
const idx = currentStep - 1;
  const ta = document.getElementById("customAnswer");
  const custom = (ta ? ta.value.trim() : "");
  if (answersMeta[idx]) answersMeta[idx].customText = custom;
  renderCaseSummary();
  persistMeta();

  const hasChoice = answersMeta[idx] && answersMeta[idx].selectedIndex >= 0;
  const hasCustom = !!custom;

  if (!hasChoice && !hasCustom) {
    alert("⚠️ 請先點選一個選項，或在下方補充一句後再繼續。");
    return;
  }

  if (currentStep < 3) {
    currentStep++;
    renderFollowupStep();
  } else {
    // all done
    setProgress(3, "第 3 步／3：快完成了，這會影響後續建議精準度");
    showDisclaimerThenGenerate();
  }
}

function prevStep() {
  if (currentStep === 1) {
    // 回到第一步（重新輸入）
    initFirstStep();
    return;
  }
if (currentStep > 1) {
    currentStep--;
    renderFollowupStep();
  }
}

// HTML escape to prevent layout break
function escapeHtml(str){
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


async function generateFinalOpinion() {
  // 新流程：先要求加入 LINE，再生成法律意見書
  window.__pendingOpinionGeneration = true;
  showLineBindModal();
  return;
}

async function continueGenerateOpinionAfterLine(){

  showLoading("AI 正在產生法律意見書中...");
  const encourEl = document.getElementById("encouragement");
  encourEl.innerText = "⛔本服務僅提供一般性資訊，內容並未涵蓋台灣法律之所有條文與適用，僅供參考。";
  encourEl.style.fontSize = "90%";
  encourEl.style.fontFamily = "'Noto Serif TC','Noto Sans TC',serif";

  try {
    const chosenScenario = (selectedScenario || customScenario || "").trim();

    const payload = {
      chosenScenario,
      followups,
      answersMeta: (answersMeta || []).map(m => ({
        selectedText: (m && m.selectedText ? m.selectedText : "").trim(),
        customText: (m && m.customText ? m.customText : "").trim()
      }))
    };

    const res = await fetch("https://flask-law-ai.onrender.com/aireport/api/opinion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error("後端回應錯誤：" + res.status);
    }

    const data = await res.json();
    const opinion = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();

    if (!opinion) {
      throw new Error("AI 回傳內容為空");
    }

    const formattedOpinion = formatOpinion(opinion);

    // Hide the auto-generated case summary panel for a cleaner final opinion
    const _csp = document.getElementById("caseSummaryPanel");
    if (_csp) { _csp.style.display = "none"; }

    stepContainer.innerHTML = `
      ${formattedOpinion}
      <div class="buttons" style="margin-top:20px;">
        <button onclick="downloadPDF()">📥 下載 PDF 版本</button>
        <button class="cta-breath" onclick="sendToLawyer()">📨 免費發送律師諮詢</button>
        <button onclick="confirmRestart()">📝 重新開始諮詢</button>
      </div>
    `;

    setProgress(3, "✅ 法律意見書已完成！");
    armSuggestAfterOpinion();
  } catch (err) {
    showError("生成法律意見書時發生錯誤，請重新嘗試。");
    console.error(err);
  }
}

function formatOpinion(text) {
  text = cleanPunct(text || "");
  const sections = text.split(/\n(?=[一二三四五]、)/g);

  let html = '';
  sections.forEach(rawSection => {
    const section = (rawSection || '').trim();
    if (!section) return;

    // 若開頭僅有「法律意見書」等標題字樣，直接略過，不顯示於畫面
    if (section === "法律意見書" ||
        section === "【法律意見書】" ||
        /^法律意見書[\s\-–—]*$/.test(section)) {
      return;
    }

    const titleMatch = section.match(/^([一二三四五]、[^:：]+)[:：]?/);
    if (titleMatch) {
      const title = titleMatch[1];
      const content = section.replace(titleMatch[0], '').trim();

      html += `
        <div class="opinion-section">
          <h3>${escapeHtml(title)}</h3>
          <div style="white-space: pre-wrap;">${escapeHtml(content)}</div>
        </div>
      `;
    } else {
      html += `<div style="white-space: pre-wrap; margin-bottom: 24px;">${escapeHtml(section)}</div>`;
    }
  });

  return html;
}


function downloadPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p', 'pt', 'a4');
  const pdfContent = document.getElementById("pdfContent");

  html2canvas(pdfContent, { scale: 2 }).then(canvas => {
    const imgData = canvas.toDataURL("image/png");
    const imgWidth = 595.28;
    const pageHeight = 841.89;
    const imgHeight = canvas.height * imgWidth / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      doc.addPage();
      doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    doc.save("法律意見書.pdf");
  });
}


function sendToLawyer() {
  alert("📨 免費發送律師諮詢功能尚未實作");
}

function applyForLawsuit() {
  alert("📝 申請訴狀撰寫功能尚未實作");
}


// ---- next script block ----



let __hasShownSuggestPrompt = false;
let __hasArmedSuggestScroll = false;
let __suggestTimerId = null;

function armSuggestAfterOpinion() {
  if (__hasArmedSuggestScroll || __hasShownSuggestPrompt) return;
  __hasArmedSuggestScroll = true;
  window.addEventListener("scroll", handleSuggestScroll, { passive: true });
}

function handleSuggestScroll() {
  if (!__hasArmedSuggestScroll || __hasShownSuggestPrompt) return;

  const scrollBottom = window.innerHeight + window.scrollY;
  const docHeight = Math.max(document.documentElement.scrollHeight || 0, document.body.scrollHeight || 0);

  // 一拉到最底部就立刻彈出提示視窗（不再等待 10 秒）
  if (scrollBottom >= docHeight - 10) {
    __hasArmedSuggestScroll = false;
    window.removeEventListener("scroll", handleSuggestScroll);
    try {
      showSuggestPrompt();
    } catch (e) {
      console.warn("showSuggestPrompt error:", e);
    }
  }
}

function showSuggestPrompt() {
  if (window.__hasShownSuggestPrompt) return;
  window.__hasShownSuggestPrompt = true;

  const overlay = document.getElementById("suggestLawyerPrompt");
  if (overlay) {
    overlay.style.display = "block";
  }
}

function closeSuggestPrompt() {
  const overlay = document.getElementById("suggestLawyerPrompt");
  if (overlay) {
    overlay.style.display = "none";
  }
}

function goToLawyerFromPrompt() {
  closeSuggestPrompt();
  try {
    openModal();
  } catch (e) {
    console.error("openModal error from suggest prompt:", e);
  }
}

function openModal() {
  document.getElementById("lawyerModal").style.display = "block";
  setupContactFormValidation();
}
function closeModal() {
  document.getElementById("lawyerModal").style.display = "none";
}
function sendToLawyer() {
  openModal();
}
function setupContactFormValidation(){
  const nameEl = document.getElementById("userName");
  const phoneEl = document.getElementById("userPhone");
  const lineEl = document.getElementById("userLine");
  const hintBox = document.getElementById("contactHint");
  const submitBtn = document.querySelector('#lawyerModal button:last-child');

  function validate(){
    const ok = nameEl.value.trim() && (phoneEl.value.trim() || lineEl.value.trim());
    if (submitBtn){
      submitBtn.disabled = !ok;
      submitBtn.style.opacity = ok ? "1" : ".6";
      submitBtn.style.cursor = ok ? "pointer" : "not-allowed";
    }
    if (hintBox){
      if (ok){
        hintBox.style.background = "#F3F9FC";
        hintBox.style.color = "#004B6B";
        hintBox.style.borderColor = "rgba(0,75,107,.15)";
        hintBox.innerHTML = '資料完整，您可以送出 👍';
      } else {
        hintBox.style.background = "#FFFDF5";
        hintBox.style.color = "#92400E";
        hintBox.style.borderColor = "rgba(245,158,11,.35)";
        hintBox.innerHTML = '請完成必填：稱呼 ＋（聯絡電話 或 LINE ID 擇一）。';
      }
    }
  }
  [nameEl, phoneEl, lineEl].forEach(el => {
    if (el){ el.addEventListener('input', validate); }
  });
  validate();
}
function submitToLawyer() {
  document.getElementById("submitStatus").style.display = "block";
  document.getElementById("submitStatus").innerText = "📨 發送中，請稍候...";

  const name = document.getElementById("userName").value.trim();
  const phone = document.getElementById("userPhone").value.trim();
  const line = document.getElementById("userLine").value.trim();
  const hintBox = document.getElementById("contactHint");
  if (!name || (!phone && !line)) {
    if (hintBox) {
      hintBox.style.background = "#FFF4F4";
      hintBox.style.color = "#B91C1C";
      hintBox.style.borderColor = "rgba(239,68,68,.45)";
      hintBox.innerHTML = '請填寫<strong>稱呼</strong>，並於<strong>聯絡電話</strong>或<strong>LINE ID</strong>擇一填寫後再送出。';
    }
    return;
  }
  
  // 台灣電話格式驗證（嚴格：手機 10 碼、09 開頭；否則走市話規則）
  // 手機驗證使用純數字；市話允許 "-" 或空白
  const digitsOnly = phone.replace(/[^\d]/g, "");
  let validPhone = false;
  if (phone) {
    if (digitsOnly.startsWith("09")) {
      // 嚴格：09 開頭且總長度必須為 10 碼
      validPhone = /^09\d{8}$/.test(digitsOnly);
    } else {
      // 市話：0 開頭但排除 09，區碼 1–3 碼，可含 - 或空白，號碼 6–8 碼
      validPhone = /^0(?!9)\d{1,3}[-\s]?\d{6,8}$/.test(phone);
    }
  }
  if (phone && !validPhone) {
    if (hintBox) {
      hintBox.style.background = "#FFF4F4";
      hintBox.style.color = "#B91C1C";
      hintBox.style.borderColor = "rgba(239,68,68,.45)";
      hintBox.innerHTML = '請輸入正確的台灣電話號碼（手機 10 碼或市話）。';
    }
    const ss = document.getElementById("submitStatus");
    if (ss) ss.style.display = "none";
    return;
  }
if (hintBox) {
    hintBox.style.background = "#F3F9FC";
    hintBox.style.color = "#004B6B";
    hintBox.style.borderColor = "rgba(0,75,107,.15)";
    hintBox.innerHTML = '資料完整，您可以送出 👍';
  }
closeModal();

  const sections = document.querySelectorAll(".opinion-section");
  let plainText = "";
  sections.forEach(section => {
    const title = section.querySelector("h3")?.innerText || "";
    const content = section.querySelector("div")?.innerText || "";
    plainText += `${title}\n${content}\n\n`;
  });

  fetch("https://flask-law-ai.onrender.com/api/email-text", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: name,
      phone: phone,
      line: line,
      text: plainText
    })
  }).then(response => {
    if (response.ok) {
      document.getElementById("submitStatus").innerText = "✅ 已成功寄出給律師！";
    } else {
      document.getElementById("submitStatus").innerText = "❌ 發送失敗，請稍後再試。";
    }
  }).catch(error => {
    document.getElementById("submitStatus").innerText = "⚠️ 發送過程中發生錯誤。";
    console.error(error);
  });
}


// ---- next script block ----


function showDisclaimerThenGenerate() {
  document.getElementById("aiDisclaimerModal").style.display = "block";
}

function proceedToGenerateOpinion() {
  document.getElementById("aiDisclaimerModal").style.display = "none";
  generateFinalOpinion();
}


// ---- next script block ----


function confirmRestart() {
  if (confirm("⚠️ 您確定要重新開始諮詢嗎？此操作將清除目前輸入的所有內容。")) {
    initFirstStep();
  }
}


// ---- next script block ----



function openNonLegalModal(){
  const overlay = document.getElementById('nonLegalOverlay');
  overlay.style.display='block';
  // trap focus on first actionable button
  const firstBtn = overlay.querySelector('.nl-btn.primary');
  if(firstBtn){ firstBtn.focus(); }
  // Clear input and reset progress similar to previous alert flow
  const inputEl = document.getElementById('initialQuestion');
  if (inputEl) inputEl.value = '';
  document.getElementById('step-container')?.scrollIntoView({ behavior: 'smooth' });
  const encour = document.getElementById('encouragement');
  if (encour) encour.innerText='';
  const prog = document.getElementById('progress');
  if (prog) prog.style.width='0%';
  // Re-init first step so layout resets
  initFirstStep();
}
function closeNonLegalModal(){
  const overlay = document.getElementById('nonLegalOverlay');
  overlay.style.display='none';
}
function focusFirstInput(){
  closeNonLegalModal();
  const inputEl = document.getElementById('initialQuestion');
  if(inputEl){ inputEl.focus(); }
}



// ---- next script block ----


// 顯示 LINE 綁定彈窗
function showLineBindModal(){
  var ov = document.getElementById("lineBindOverlay");
  if (ov) ov.style.display = "block";
}

// 關閉彈窗並繼續原本分析流程
function proceedAfterLine(){
  var ov = document.getElementById("lineBindOverlay");
  if (ov) ov.style.display = "none";
  // 回到原始的分析流程
  
if(window.__pendingOpinionGeneration){
  window.__pendingOpinionGeneration = false;
  continueGenerateOpinionAfterLine();
}else{
  actuallySubmitInitialQuestion();
}

}

// === Multi-path guard（多路徑導流）：避免一開始被單一路徑鎖死 ===
// === Multi-path guard（多路徑導流）：避免一開始被單一路徑鎖死 ===
// 規則：若輸入同時可能對應多個法律方向，先跳出「聚焦方向」讓使用者選擇。
// forcedKey 會直接對應 LAWAI_SCENARIO_ASSETS 的 key（可被模板套用）。

const MULTI_PATH_RULES = [
  {
    group: "婚姻/外遇",
    match: (s)=> /(外遇|出軌|劈腿|偷吃|不忠|通姦|小三|小王|第三者|婚外情)/.test(s) && /(太太|老婆|妻子|妻|老公|先生|丈夫|配偶|另一半|伴侶)/.test(s),
    paths: [
      { key:"離婚",      title:"離婚相關",    icon:"gavel",    tone:"fact", desc:"先釐清是否具離婚事由、是否要走協議/調解/訴訟，以及子女/財產/扶養等安排。" },
      { key:"侵害配偶權", title:"侵害配偶權", icon:"favorite", tone:"resp", desc:"聚焦第三者/配偶不法侵害之證據、精神慰撫金（賠償）請求，以及訴訟與和解策略。" }
    ]
  },
  {
    group:"金錢/借貸/詐騙",
    match:(s)=> /(借|欠|貸款|利息|本息|還款|催討|對方不還|匯款|轉帳|帳戶|詐騙|騙|投資|代購|保證獲利)/.test(s),
    paths:[
      { key:"借貸", title:"借貸/清償請求", icon:"payments", tone:"fact", desc:"以借貸合意與金流證明為主，先釐清借款事實、利息約定與催討紀錄。" },
      { key:"詐欺", title:"詐欺/刑事告訴", icon:"report",   tone:"resp", desc:"以詐欺構成與報案資料為主，先釐清對方話術、交付原因、收款帳戶與證據保存。" }
    ]
  },
  {
    group:"房屋/鄰損/公寓大廈",
    match:(s)=> /(漏水|滲水|壁癌|管線|修繕|鄰損|噪音|惡鄰|大樓|管委會|公設|公共區域|頂樓|陽台)/.test(s),
    paths:[
      { key:"房屋漏水", title:"房屋漏水/修繕", icon:"home",        tone:"fact", desc:"先釐清漏水來源、修繕責任、估價與通知紀錄，並做證據保全（照片/鑑定）。" },
      { key:"公寓大廈", title:"管委會/公設爭議", icon:"apartment", tone:"resp", desc:"聚焦規約/區分所有權人會議決議、管委會權限，以及管理費與修繕分擔。" }
    ]
  }
];

function detectMultiPathConfig(text){
  const s = String(text || "").trim();
  if (!s) return null;

  // 若使用者已強制選擇路徑，則不再彈出
  if ((window.__forcedCaseType || "").trim()) return null;

  for (const rule of MULTI_PATH_RULES){
    try{
      if (rule.match && rule.match(s)){
        const paths = (rule.paths || []).filter(p => p && p.key && p.title);
        if (paths.length >= 2){
          return {
            group: rule.group || "多路徑",
            hint: "你的描述可能同時落在多個法律方向。先選擇你現在最想聚焦的方向（後續仍可再切換）。",
            paths
          };
        }
      }
    }catch(e){}
  }
  return null;
}

function openLegalPathOverlay(config){
  const ov = document.getElementById("legalPathOverlay");
  if (!ov) return;

  const titleEl = document.getElementById("legalPathTitle");
  const hintEl  = document.getElementById("legalPathHint");
  const cardsEl = document.getElementById("legalPathCards");
  const explainEl = document.getElementById("legalPathExplain");

  if (explainEl) explainEl.style.display = "none";
  if (cardsEl) cardsEl.style.display = "grid";

  const group = (config && config.group) ? String(config.group) : "聚焦方向";
  const hint  = (config && config.hint) ? String(config.hint) : "";

  if (titleEl) titleEl.innerText = "請先選擇你要聚焦的方向（" + group + "）";
  if (hintEl) hintEl.innerText = hint || "先選擇最想聚焦的方向，避免系統一開始把方向鎖死。";

  if (cardsEl){
    cardsEl.innerHTML = "";
    const paths = (config && Array.isArray(config.paths)) ? config.paths : [];
    const col = Math.min(Math.max(paths.length, 2), 3);
    cardsEl.style.gridTemplateColumns = "repeat(" + col + ", minmax(0, 1fr))";

    paths.forEach((p)=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "legal-path-card";
      btn.innerHTML = `
        <div class="legal-path-icon material-icons">${p.icon || "gavel"}</div>
        <div class="legal-path-title">${p.title || ""}</div>
        <div class="legal-path-desc">${p.desc || ""}</div>
      `;
      btn.addEventListener("click", ()=> selectLegalPath(p.title, p.key, group));
      cardsEl.appendChild(btn);
    });
  }

  ov.style.display = "block";
}

function closeLegalPathOverlay(){
  const ov = document.getElementById("legalPathOverlay");
  if (ov) ov.style.display = "none";
}

function showLegalPathExplain(){
  const box = document.getElementById("legalPathExplain");
  if (box) box.style.display = "block";
  const cards = document.getElementById("legalPathCards");
  if (cards) cards.style.display = "none";
}

// pathLabel: 使用者看到的文字；forcedKey: 資產 key（對應 LAWAI_SCENARIO_ASSETS）
function selectLegalPath(pathLabel, forcedKey, group){
  window.__legalPath = String(pathLabel || "").trim();
  window.__forcedCaseType = String(forcedKey || "").trim();
  window.__legalPathGroup = String(group || "").trim();

  try{
    const prev = JSON.parse(localStorage.getItem("lawai_answers_meta") || "{}");
    prev.legalPath = window.__forcedCaseType;
    prev.legalPathLabel = window.__legalPath;
    prev.legalPathGroup = window.__legalPathGroup;
    localStorage.setItem("lawai_answers_meta", JSON.stringify(prev));
  }catch(e){}

  closeLegalPathOverlay();
  // 回到原流程：繼續送出分析（此時 __forcedCaseType 已存在，不會再跳出 overlay）
  
if(window.__pendingOpinionGeneration){
  window.__pendingOpinionGeneration = false;
  continueGenerateOpinionAfterLine();
}else{
  actuallySubmitInitialQuestion();
}

}




function showDisclaimerAfterOpinion(){
  var m=document.getElementById("aiDisclaimerModal");
  if(m){m.style.display="block";}
}
function confirmDisclaimer(){
  var m=document.getElementById("aiDisclaimerModal");
  if(m){m.style.display="none";}
}
