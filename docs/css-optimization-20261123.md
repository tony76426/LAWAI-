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
- **Browser visual regression and real-device Lighthouse tests are not yet measured**. Before changing deployed traffic further, compare 360/390/430/768/1024/1440/1920 px including mobile drawer, fixed tab bar, AI/LINE CTAs, and CSS hero crop. Confirm LCP element + 75th percentile field metrics separately.

## Rollback
Restore `index.html` and `lawai_contral.css` from backup branch, or revert the optimization merge; unrelated website files remain untouched.
