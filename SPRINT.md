# Sprint Plan

## CONTEXT_DIGEST
用戶回報兩個結帳問題：(1) 插件端點數加值數量無法複選，(2) 官網付費牆無法跳轉並報錯。
經查，(1) 是因為後端 `/api/user.js` 未接收前端傳入的 `quantity` 參數，硬編碼為 1；(2) 是因為官網前端使用 `window.open` 若被瀏覽器阻擋回傳 `null` 時，缺乏 fallback 機制，導致直接觸發錯誤提示。

## TASKS

- [x] [MUST] Task 1: 修復結帳數量硬編碼問題（端到端）
  - **影響檔案**: `loamlab_backend/api/user.js`、`loamlab_backend/api/webhook.js`、`loamlab_backend/lib/activate.js`
  - **描述**: 結帳端 `user.js` 從 `req.body` 解析 `quantity`（淨化為整數、預設 1），寫入 `product_cart[0].quantity` 與 `metadata.quantity`。
  - **調整原因**: 原 SPRINT 只列 `user.js`，但發點端 `webhook.js` / `activate.js processTopup` 從不讀 quantity，僅改結帳端會造成「Dodo 收 N× 錢、只發 1× 點」的財務損害。已補：`webhook.js` 取 `metadata.quantity` 傳入 `processTopup`；`processTopup` 對加值包 `pointsToAdd = plan.points * qty`，訂閱方案強制鎖 1；補發路徑 `reconcilePaymentsForEmail` 同步。
  - **測試**: 11 項單元測試全通過（qty=1/3/字串/0/null/非法、訂閱鎖 1）。

- [x] [MUST] Task 2: 修復 HTML 官網付費牆跳轉失敗問題
  - **影響檔案**: `loamlab_backend/public/index.html`
  - **描述**: 在 `handleCheckout` 函數中，收到 `data.checkoutUrl` 後，若 `win` 存在則使用 `win.location.href` 導向，若 `win` 為 `null` 則 fallback 使用 `window.location.href` 導向，避免因 popup blocker 阻擋導致跳轉失敗。

- [x] [MUST] Task 3: ~~修復 Next.js 官網付費牆跳轉失敗問題~~ —— 作廢
  - **原因**: SPRINT 誤把 `loamlab_website`（Next.js）當成線上站。實際線上行銷站是 `loamlab-camera.vercel.app`，由 `loamlab_backend/public/index.html` 提供（見 T2）。`loamlab_website` 是已廢棄的舊改版站，無自訂網域、無任何引用。
  - **處置**: 該站的 fallback 改動曾隨 commit `1d47514` 提交（不生效），後續 commit 已整個移除 `loamlab_website/` 目錄。

status: DONE

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_backend/api/user.js
  - loamlab_backend/api/webhook.js
  - loamlab_backend/lib/activate.js
  - loamlab_backend/public/index.html
  - SPRINT.md
  - CLAUDE.md            # 移除對已廢棄 loamlab_website 的引用
  - loamlab_website/**   # 整個目錄移除（已廢棄舊站）
sql_migration: false
