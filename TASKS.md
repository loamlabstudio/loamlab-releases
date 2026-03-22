# 任務看板 (TASKS.md)

> **所有 session 開始前必讀，完成後必更新。**
> 這是唯一的 agent 溝通頻道。

---

## 狀態說明

| 狀態 | 意義 |
|---|---|
| `[OPEN]` | 可認領 |
| `[ACTIVE]` | 已有 session 在做，不要碰同一個檔案 |
| `[DONE]` | 完成，等待整合 |
| `[BLOCKED]` | 卡住，需要人工介入 |

---

## 任務清單

| ID | 模組 | 任務描述 | 檔案範圍（只碰這些） | 狀態 | Branch |
|---|---|---|---|---|---|
| T01 | 範例 | 範例任務（可刪除） | `loamlab_plugin/ui/app.js` | `[DONE]` | `main` |
| T02 | Plugin UI | i18n Bug 修復（工具 2/3 標題/hint/placeholder、progress bar、進階設定/自動存檔/鏡頭風格/Live Viewport 卡片標題）+ Pricing Modal 多語系幣種成本顯示 | `loamlab_plugin/ui/i18n.js`, `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html` | `[DONE]` | `main` |
| T03 | 支付+特權 | P0-4 填入真實 LemonSqueezy Variant ID + 設定 Webhook URL + 建立折扣碼（上個 session P0-1/2/3 已完成部署） | `loamlab_backend/api/webhook.js`, `loamlab_plugin/ui/app.js` | `[DONE]` | `main` |
| T04 | 邀請碼/裂變 | 邀請碼系統重構：referral.js 改為純綁定、render.js 首次渲染觸發 B+100/A+300、webhook.js 移除邀請碼邏輯、app.js SHARE 按鈕與自動彈 Modal、index.html 說明文案更新 | `loamlab_backend/api/referral.js`, `loamlab_backend/api/render.js`, `loamlab_backend/api/webhook.js`, `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html` | `[DONE]` | `main` |
| T05 | 反饋系統 | 建立完整反饋收集系統：feedback table + API、渲染後 Rating Bar（👍/👎 + 差評標籤）、錯誤一鍵回報、Beta Feedback modal 替換 mailto、render.js 記錄 plugin_version/transaction_id | `loamlab_backend/supabase_setup.sql`, `loamlab_backend/api/feedback.js`(新), `loamlab_backend/api/render.js`, `loamlab_plugin/main.rb`, `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/i18n.js`, `loamlab_plugin/ui/index.html` | `[DONE]` | `main` |

---

## 整合佇列（DONE 後等待合併）

> 所有 `[DONE]` 的任務在這裡等待 merge 到 main，然後統一 build + release。

- [x] T04 — 邀請碼/裂變重構（main）— ✅ 已部署 vercel --prod（2026-03-22）
- [x] T05 — 反饋系統（main）— ✅ 已部署 vercel --prod（2026-03-22）；Gmail 通知已上線；待：① Supabase 執行新 SQL 段落 ② SketchUp 熱重載驗收

---

## 規則（3 條）

1. **開 session → 先讀此文件** → 認領一個 `[OPEN]` 任務，改為 `[ACTIVE]`，填入 branch 名
2. **只碰「檔案範圍」欄位列出的文件** — 其他 session 的範圍絕對不碰
3. **完成 → 改狀態為 `[DONE]`** → 把 branch 名填入整合佇列

