# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LoamLab AI Renderer (土窟設計 SU 渲染插件)** — An AI-powered image rendering plugin for SketchUp. Users capture a SketchUp scene, the plugin sends it to a Vercel serverless backend, which calls the Coze Workflow API for AI image generation and deducts the user's points balance.

**Current version:** 1.2.0-beta (confirm in `AGENTS_CHECKLIST.md`)

---

## Architecture

### Two-Component System

```
SketchUp Plugin (Ruby + HTML/JS)  ──POST──►  Vercel Backend (Node.js)  ──►  Coze API
        loamlab_plugin/                         loamlab_backend/api/            (AI image gen)
                                                        │
                                                   Supabase (PostgreSQL)
                                                   (users, points, referrals)
```

### Plugin Side (`loamlab_plugin/`)
- **`main.rb`** — Dialog init, Ruby↔JS bridge callbacks, thread-safe task queue (`ThreadQueue`), scene export
- **`coze_api.rb`** — Base64-encodes JPEG → POSTs to Vercel backend → handles streaming response
- **`config.rb`** — Environment mode (`ENV_MODE`: `development` / `production`) and API base URL
- **`updater.rb`** — Version check against `/api/version`
- **`ui/app.js`** — Progress bar, resolution/aspect ratio selection, payment UI, image preview
- **`ui/i18n.js`** — English + Traditional Chinese strings; dynamic language switching
- **`loamlab_plugin.rb`** — Entry point loaded by SketchUp

### Backend Side (`loamlab_backend/api/`)
- **`render.js`** — Core: deduct points (waterfall: monthly `points` → `lifetime_points`), upload image to freeimage.host (fallback: ImgBB), call Coze stream API, return SSE stream; refunds on any failure; grants referral rewards on first render (new user B +100 / referrer A +300)
- **`user.js`** — Fetch user profile; auto-registers new users with 10-point signup bonus
- **`webhook.js`** — LemonSqueezy webhook (HMAC-SHA256 on `X-Signature` header); maps variant IDs to point values; must disable bodyParser for raw body access
- **`referral.js`** — Generate/validate referral codes
- **`stats.js`** — System-wide totals (users, points issued)
- **`version.js`** — Returns `latest_version`, `release_notes`, `download_url`; updated by `release.ps1` before each release
- **`fix_anomalies.js`** — Admin-only endpoint (requires `ADMIN_KEY` query param in production) to fix negative point balances in DB
- **`feedback.js`** — Collect render ratings (👍/👎) and negative-feedback tags; one-click error report; records `plugin_version` and `transaction_id`
- **`materials.js`** — Material library cloud CRUD (GET/POST/DELETE); per-item limit by subscription plan (free: 20 / Pro+: 200)
- **`inpaint.js`** — Local re-render (inpainting); accepts base64 mask + rendered image, calls Fal.ai API, returns swapped result
- **`auth/`** — OAuth login (`login.js`) → callback (`callback.js`) → session polling (`poll.js`); poll also generates `referral_code` for new users

### Database (Supabase)
Schema defined in `supabase_setup.sql`. See `POINTS_SYSTEM.md` for pricing details and full schema SQL.

Key tables:
- **`users`**: `points` (monthly, reset), `lifetime_points` (permanent), `referral_code`, `referred_by`, `referral_rewarded`
- **`transactions`**: audit log per render/refund/fix; insert is wrapped in try/catch so missing table won't crash main flow

### Points Pricing
- 1K render: 15 pts | 2K: 20 pts | 4K: 25 pts
- Signup bonus: 10 pts
- Referral bonus (first render): new user B +100 pts / referrer A +300 pts

---

## 環境隔離架構（Dev vs Public Beta）

### 核心規則
**`.rbz` 打包件是唯一的隔離邊界。** 用戶安裝的版本是凍結的，開發者的 workspace 是活的。兩者打同一個 Production Vercel 後端，但不互相干擾（各用各的帳號）。

```
[開發者 workspace]                     [公測用戶安裝的 .rbz]
BUILD_TYPE = "dev"                     BUILD_TYPE = "release"
ENV_MODE   = "production"              ENV_MODE   = "production"
      ↓                                       ↓
Production Vercel（開發者帳號測試）    Production Vercel（用戶帳號）
```

### 兩個獨立開關
| 變數 | 職責 | 開發版 | 發布版 |
|---|---|---|---|
| `ENV_MODE` | 打哪個後端 | `production` | `production` |
| `BUILD_TYPE` | 是否為開發者構建 | `dev` | `release` |

> `ENV_MODE` 現在恆為 `production`，不再用來區分環境。`BUILD_TYPE` 是唯一決定 DEV badge 與 preferences_key 的開關。

### 環境辨別方式
| | 開發版（workspace） | 公測版（.rbz） |
|---|---|---|
| UI 標記 | 頂部紅色 `DEV` badge | 無 badge |
| Dialog 標題 | `LoamLab AI Renderer [DEV]` | `LoamLab AI Renderer` |
| SketchUp preferences_key | `com.loamlab.airenderer.dev` | `com.loamlab.airenderer` |
| 後端 | Production Vercel | Production Vercel |

### 不變的規則
- **`config.rb` 在 repo 裡永遠是 `BUILD_TYPE = "dev"`** — `build_rbz.ps1` 打包時自動切為 `release`，完成後恢復
- **`build_rbz.ps1` 是唯一能產生 release 版本的路徑** — 任何手動改動都不算發布
- **Variant ID 維護點**：`app.js` 的 `LS_VARIANTS` 物件（前端）與 `webhook.js` 的 `VARIANT_*` 常數（後端）必須同步更新

---

## Build & Deploy

### Package Plugin (`.rbz`)
```powershell
./build_rbz.ps1
```
Auto-switches `config.rb` to production mode before packaging. Output: `loamlab_plugin.rbz`

### Deploy to SketchUp (Development)
```powershell
./setup_dev_link.ps1   # Create symlink for live development
./deploy_to_su.ps1     # Copy to SketchUp plugins directory
```

### Hot Reload (Development) — 無需重啟 SketchUp
每次修改代碼後，在 SketchUp 選單「視窗 → Ruby 控制台」執行：
```ruby
load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/dev_reload.rb'
```
此指令會：關閉舊對話框 → 移除舊模組常數 → 重載 config/coze_api/main → 重開 UI 視窗。
**原則：每次迭代後必須用此指令熱重載，不得要求用戶重啟 SketchUp。**

### Run Backend Locally
```bash
# From loamlab_backend/
vercel dev   # Starts local server at localhost:3001
```

### ⚠️ PowerShell 執行原則限制（此機器永久規則）
此機器 ExecutionPolicy = Restricted，所有 vercel/npm 指令必須用：
```powershell
powershell -ExecutionPolicy Bypass -Command "vercel --prod"
powershell -ExecutionPolicy Bypass -File ".\script.ps1"
```
**直接執行 `vercel` 或 `.\script.ps1` 一定會失敗，不要嘗試。**
Remember to set `ENV_MODE = "development"` in `config.rb` when testing locally.

### Backend (Vercel)
```bash
# Deploy via Vercel CLI from loamlab_backend/
vercel --prod
```
Vercel timeout is set to 300s in `vercel.json` (required for long-running Coze renders).

### Release New Version
```powershell
# Update version.js and tag — update CURRENT_VERSION in AGENTS_CHECKLIST.md + config.rb + version.js first
./release.ps1
```

### Test Coze API
```ruby
ruby test_coze_api.rb
ruby test_coze_stream.rb
```

### Admin: Fix Point Anomalies
```
GET https://loamlabbackend.vercel.app/api/fix_anomalies?key=<ADMIN_KEY>
```

---

## Multi-Agent 協作協議（每個新 Session 必讀）

**開 session 三步：**
1. 讀 `TASKS.md` — 確認沒有衝突的 `[ACTIVE]` 任務
2. 認領或新增一個任務，改狀態為 `[ACTIVE]`，填 branch 名
3. **只碰自己任務欄位列出的檔案**

**完成三步：**
1. commit 到自己的 branch
2. 把 `TASKS.md` 的狀態改為 `[DONE]`
3. 在「整合佇列」加一行，等待 merge

**模組 → 檔案範圍速查：**
| 模組 | 負責檔案 |
|---|---|
| 支付 | `loamlab_backend/api/webhook.js`, `loamlab_plugin/ui/app.js`（LS_VARIANTS 部分） |
| 渲染後端 | `loamlab_backend/api/render.js` |
| 用戶/點數 | `loamlab_backend/api/user.js`, `loamlab_backend/api/referral.js` |
| Plugin UI | `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/i18n.js` |
| Plugin 核心 | `loamlab_plugin/main.rb`, `loamlab_plugin/coze_api.rb` |
| 版本/更新 | `loamlab_plugin/updater.rb`, `loamlab_backend/api/version.js` |

---

## i18n 規則（新增 UI 字串必讀）

每次新增 UI 字串，**必須同時補全所有 6 種語言**：
`zh-TW` / `en-US` / `zh-CN` / `es-ES` / `pt-BR` / `ja-JP`

**操作步驟：**
1. 在 `loamlab_plugin/ui/i18n.js` 的 6 個語言物件中同時加入同一個 key
2. 若無法翻譯，**複製 `en-US` 值作為佔位符** — 絕對不可只加 zh-TW 或 en-US 後就 commit
3. 在 `app.js` 中使用 `t('key')` helper（自動 fallback 到 en-US，避免 undefined）
4. 切換 DEV 版插件，開啟 SketchUp Ruby Console，確認**無 `[i18n] missing` 警告**

**驗證指令（瀏覽器 console 可執行）：**
```javascript
Object.keys(UI_LANG).forEach(l => {
    const missing = Object.keys(UI_LANG['en-US']).filter(k => !(k in UI_LANG[l]));
    if (missing.length) console.warn(l, 'missing:', missing);
});
```

**禁止行為：**
- 在 JS/HTML 中直接 hardcode 中文字串（使用 `t('key')` 代替）
- 在有子元素的 div 上使用 `data-i18n`（會被 textContent 覆蓋掉子元素）

---

## 文件同步規則（Doc Sync Protocol）

每次改動完成後，**必須主動詢問**是否需要同步更新相關文件。不需要自動寫入，詢問後由用戶確認再執行。

| 改動類型 | 需同步的文件 |
|---------|------------|
| 點數定價、新人贈點、扣款邏輯 | `POINTS_SYSTEM.md` |
| 新功能上線、工具啟用、Phase 推進 | `PRODUCT_PLAN.md` / `roadmap.md` |
| 版本號更新、Release 發布 | `AGENTS_CHECKLIST.md`（`CURRENT_VERSION`）、`version.js` |
| 後端 API 新增/修改端點 | `CLAUDE.md`（Architecture 章節） |
| 付費/結帳/Webhook 邏輯 | `Summon_Billing.md` / `Summon_Fintech.md` |
| 環境變數新增或移除 | `CLAUDE.md`（Environment Variables 章節） |

**觸發時機**：每次 commit 後，對照上表自動判斷：
- 改動類型**明確匹配**表中條目 → 直接執行同步，commit message 末尾標注「已同步 [文件名]」
- 改動類型**跨多個條目或範圍不明確** → 才詢問：「此次改動可能涉及 [文件名1] / [文件名2]，請確認是否同步」

---

## Key Constraints

- **Backend uses Node.js 18+ native `fetch`** — do NOT add `node-fetch` require (causes CJS/ESM conflict); `node-fetch` remains in `package.json` as legacy but must never be `require()`'d
- **`ENV_MODE` in `config.rb`** must be `development` for local testing (connects to `localhost:3001`); `build_rbz.ps1` switches it to `production`. **Warning**: `config.rb` in the repo is currently set to `production` — always verify before local testing
- **Production API URL discrepancy**: `config.rb` hardcodes `https://loamlabbackend.vercel.app` but `AGENTS_CHECKLIST.md` lists `https://loamlab-plugin-backend.vercel.app` — treat `config.rb` as the source of truth
- **Webhook signature** uses HMAC-SHA256 with `X-Signature` header (LemonSqueezy); webhook handler must disable Vercel's default `bodyParser` to access raw body
- **Points waterfall**: always deduct `points` first, then `lifetime_points`; refund on any Coze/upload failure by restoring original values
- **Image hosting pipeline**: `render.js` uploads Base64 images to freeimage.host first; falls back to ImgBB if that fails; refunds and aborts if both fail
- **Cost detection in `render.js`**: resolution tier (`1K`/`2K`/`4K`) is inferred by string-searching the JSON payload — ensure resolution strings are consistent between plugin and backend
- **`fix_anomalies.js` has a mixed CJS/ESM bug**: uses `require()` (CommonJS) but also `export default` — avoid touching until refactored

---

## Environment Variables (`loamlab_backend/.env.local`)

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | |
| `SUPABASE_ANON_KEY` | `render.js`, `user.js`, `stats.js` | Note: CLAUDE.md previously said `SUPABASE_SERVICE_ROLE_KEY` — the actual key in code is `SUPABASE_ANON_KEY` |
| `COZE_PAT` | `render.js` | Coze Personal Access Token |
| `WORKFLOW_ID` | `render.js` | Coze Workflow ID (fallback hardcoded in code) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | `webhook.js` | HMAC signing secret |
| `IMGBB_API_KEY` | `render.js` | Fallback image host; hardcoded default exists |
| `ADMIN_KEY` | `fix_anomalies.js` | Guards admin endpoint in production |
