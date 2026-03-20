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
- **`render.js`** — Core: deduct points (waterfall: monthly `points` → `lifetime_points`), upload image to freeimage.host (fallback: ImgBB), call Coze stream API, return SSE stream; refunds on any failure
- **`user.js`** — Fetch user profile; auto-registers new users with 10-point signup bonus
- **`webhook.js`** — LemonSqueezy webhook (HMAC-SHA256 on `X-Signature` header); maps variant IDs to point values; handles referral rewards (200+200); must disable bodyParser for raw body access
- **`referral.js`** — Generate/validate referral codes
- **`stats.js`** — System-wide totals (users, points issued)
- **`version.js`** — Returns `latest_version`, `release_notes`, `download_url`; updated by `release.ps1` before each release
- **`fix_anomalies.js`** — Admin-only endpoint (requires `ADMIN_KEY` query param in production) to fix negative point balances in DB
- **`auth/`** — OAuth login (`login.js`) → callback (`callback.js`) → session polling (`poll.js`); poll also generates `referral_code` for new users

### Database (Supabase)
Schema defined in `supabase_setup.sql`. See `POINTS_SYSTEM.md` for pricing details and full schema SQL.

Key tables:
- **`users`**: `points` (monthly, reset), `lifetime_points` (permanent), `referral_code`, `referred_by`, `referral_rewarded`
- **`transactions`**: audit log per render/refund/fix; insert is wrapped in try/catch so missing table won't crash main flow

### Points Pricing
- 1K render: 15 pts | 2K: 20 pts | 4K: 25 pts
- Signup bonus: 10 pts
- Referral bonus (first purchase): 200 pts to both referrer and referee

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

## Development Workflow (AI Agent Protocol)

This project uses a multi-agent coordination system. At the start of each session:

1. Read `AGENTS_CHECKLIST.md` — confirm `CURRENT_VERSION` and `PATH_MAPPING`
2. Read `AGENTS_SYNC.md` — check `🚩 總隊長令` (Commander's orders) and update your `[HEARTBEAT]`
3. Check source files for `@Task` comments — these are emergency fix directives

**Auto-role by file path:**
- `loamlab_plugin/` → Plugin/UI role (Ruby/JS)
- `loamlab_backend/` → Backend/Payment role (Node.js/API)
- `render.js` or render tests → Rendering quality role

When a task is claimed, update status in `AGENTS_SYNC.md` from `[PENDING]` → `[WORKING]`. After completion, write evidence and mark `@Orchestrator 請求巡檢`.

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
