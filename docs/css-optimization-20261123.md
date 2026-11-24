# LawAI CSS safe optimization — 2026-11-23

## Scope / rollback
- Production: `index.html` uses `lawai_contral.min.css` generated from `lawai_contral.css`.
- Original full version: branch `backup/pre-css-optimization-20261123`, original head `5706c5d30de46e4b8c6a079861d9d2db9bc53977`.
- Structural design, color, typography and sizing for **retained selectors are unchanged**. Changes are intentionally conservative.

## Change summary
- Removed 2 invalid orphaned declaration fragments and 22 empty media blocks.
- Removed 66 rules of dormant logo/tech/statistics/collapsible/carousel child components verified absent from `index.html`, `lawai_runtime.js`, and `lawai_header_scroll.js`; other rules preserved in original order.
- Raw CSS: 60121 → 51189 characters; minified: 46844 characters (UTF-8 file sizes differ due to CJK comments).
- Important declarations: 237 → 228; media blocks: 0 → 0.
- Main banner remains eager/high priority. Secondary section's two high-priority preload tags removed; actual responsive background CSS unchanged.
- Removed exact duplicate inline `.intro-seo-safe` rule from head; same source rule still exists in main CSS.

## Maintainability
- Edit `lawai_contral.css` only; then run `node scripts/build-css.mjs` and commit both source and minified stylesheet. CI checks bundle consistency.
- Do not revert to duplicate high-priority preloads for the second hero background unless RUM/trace data proves it beneficial.

## Static verification
- Verified syntactic brace balance, zero orphan braces, exact preserved order and declarations for every retained CSS style rule, identical pre/post-minification rule signatures, and primary image resource hints.
- PR #1 的 GitHub Actions Chromium 視覺回歸已在 360/390/430/768/1024/1440/1920 px 通過；這是受控桌面瀏覽器中的截圖測試，**不是實體手機或正式站 Lighthouse**。
- 2026-11-23 後續驗收加入：PR 基準版本動態選取、390/768/1440 px 中段及底部截圖、手機抽屜選單開關與 Escape 鍵檢查。
- `node scripts/verify-homepage.mjs` 檢查首頁單一 LCP 圖片預載、來源檔案、入口路徑；`--production` 使用只讀 HTTP GET 核對正式站 CSS 雜湊、主要圖片與入口頁面是否回傳正常內容。
- `LawAI production homepage resources and Lighthouse` 在 PR 或非 main 手動執行時只驗證候選版本（CSS 同步、首頁靜態檢查及 mock HTTP 回歸測試），不比較尚未部署的 CSS。main push 或 main 手動執行才核對正式站，最多六次重試等待部署；如部署超出重試時間，部署完成後手動在 main 重跑。
- 正式站檢查從實際首頁解析完整 stylesheet URL（包含版本 query），確認 MIME、非空內容、SHA-256 及首頁引用版本與 checkout 一致，不以無 query 的 CSS 代替。`node --test scripts/verify-homepage.test.mjs` 可離線回歸測試。
- Lighthouse 手機模擬與桌面報告僅在 main 正式站驗證後產生，採資訊性記錄，不作為部署成功保證。
- **待人工確認**：實體 iOS/Android 手機、第三方字體及登入/外部連結互動，以及正式站 CrUX/RUM 第 75 百分位 LCP/INP/CLS。

## Rollback
Restore `index.html` and `lawai_contral.css` from backup branch, or revert the optimization merge; unrelated website files remain untouched.
