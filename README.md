# AI Report｜獨立完整檔案包（2026-11-09）
來源：GitHub tony76426/LAWAI- 主分支，提交 53d87332ea949e81ba01e745d1250fe6c453bfd2
本包保留 AI Report 頁面及其直接相依的 7 個 JavaScript / CSS 檔案，檔案名稱均與部署時一致。

## 本次調整
- 動態追問自動以「（一）（二）（三）」分行呈現。
- 主要問題字重恢復 700 粗體，編號加強為 800。
- 題目含換行時正常分項；未換行但恰為三句時提供安全的句點拆分。
- 不改動情境選項、語音輸入、法律分析及 PDF 匯出邏輯。
- 調整 HTML 中 CSS/JS 的版本參數，避免舊版快取。

## 使用
將所有檔案放在網站同一個目錄，以網站網址開啟 aireport.html。
本檔案包不包含網站的首頁 index.html、服務說明.html 與後端 API。
AI 分析、輸入語音以及 PDF 功能需於正常網站環境測試。

## 檔案
- aireport.html
- aireport_app.js
- aireport_pdf_export.js
- aireport_report.css
- aireport_report.js
- aireport_style.css
- lawai_config.js
- lawai_runtime.js
