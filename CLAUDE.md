# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**LoamLab AI Renderer (土窟設計 SU 渲染插件)** — SketchUp plugin + Vercel backend + Coze API + Supabase。
Users capture a SketchUp scene → backend deducts points → Coze generates AI image → returns to plugin.

**Current version:** confirm in `loamlab_plugin/config.rb` (`VERSION`) or `AGENTS_CHECKLIST.md`

## Architecture

SketchUp Plugin (`loamlab_plugin/`, Ruby + HTML/JS) → Vercel Serverless (`loamlab_backend/api/`, Node.js) → Coze API / Supabase (PostgreSQL)。

Key files: `main.rb` (dialog + Ruby↔JS bridge), `coze_api.rb` (image upload + streaming), `render.js` (points waterfall + image hosting + Coze call), `webhook.js` (LemonSqueezy payments), `user.js` (auto-register + profile)。
Schema: `supabase_setup.sql`；定價邏輯: `POINTS_SYSTEM.md`。

---

## 環境隔離（Dev vs Direct vs EW）

`.rbz` 是隔離邊界；開發者與用戶用各自帳號打同一個 Production Vercel。

| 變數 | 開發版（repo 預設）| Direct 發布版 | EW 審核版 | 職責 |
|---|---|---|---|---|
| `BUILD_TYPE` | `"dev"` | `"release"` | `"release"` | DEV badge、preferences_key 分離 |
| `DIST_CHANNEL` | `"direct"` | `"direct"` | `"store"` | 控制自動更新邏輯 |
| `ENV_MODE` | `"production"` | `"production"` | `"production"` | 恆定 |
| `updater.rb` | 含 | 含 | **排除** | EW 審核不允許 update 功能 |

- `config.rb` 在 repo 裡永遠是 `BUILD_TYPE = "dev"`, `DIST_CHANNEL = "direct"` — 打包腳本自動切換，完成後恢復
- **DEV Reload 選單項**必須包在 `if LoamLab::BUILD_TYPE == "dev"` 條件內（公測版不顯示）
- **EW 版 update callbacks** 在 `main.rb` 以 `DIST_CHANNEL != 'store'` gate，審核員看不到 update 能力
- Variant ID 雙維護點：`app.js` 的 `LS_VARIANTS` ↔ `webhook.js` 的 `VARIANT_*` 必須同步更新

---

## Build & Deploy

### ⚠️ PowerShell 執行原則限制（此機器永久規則）
此機器 ExecutionPolicy = Restricted，所有 vercel/npm/.ps1 指令必須用 Bypass：
```powershell
powershell -ExecutionPolicy Bypass -Command "vercel --prod"
powershell -ExecutionPolicy Bypass -File ".\script.ps1"
```
**直接執行 `vercel` 或 `.\script.ps1` 一定會失敗。**

### Package Plugin (`.rbz`)
```powershell
# Direct 版（官網發布，含自動更新）
powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1"

# EW 版（Extension Warehouse 審核專用，無更新功能）
powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1" -ew
```
Direct 版：`BUILD_TYPE=release`, `DIST_CHANNEL=direct`，輸出 `loamlab_plugin.rbz`
EW 版：`BUILD_TYPE=release`, `DIST_CHANNEL=store`，排除 `updater.rb`，輸出 `loamlab_plugin_ew.rbz`

### Deploy to SketchUp (Development)
```powershell
powershell -ExecutionPolicy Bypass -File ".\setup_dev_link.ps1"   # Create symlink
powershell -ExecutionPolicy Bypass -File ".\deploy_to_su.ps1"     # Copy to plugins dir
```

### Hot Reload（禁止要求用戶重啟 SketchUp）
```ruby
load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/dev_reload.rb'
```
在 SketchUp Ruby Console 執行。自動關閉舊視窗 → 移除模組常數 → 重載 config/coze_api/main → 重開 UI。

### Run Backend Locally
```bash
# From loamlab_backend/; remember to set ENV_MODE = "development" in config.rb first
powershell -ExecutionPolicy Bypass -Command "cd loamlab_backend; vercel dev"
```

### Release New Version（完整四步，說「發佈更新」直接執行不再詢問）
1. 版本號遞增（patch +1），同步 `config.rb` (`VERSION`) / `loamlab_plugin.rb` (`ext.version`) / `loamlab_backend/api/version.js` (`latest_version` + `download_url`) → commit
2. `powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1"`
3. 在 `loamlabstudio/loamlab-releases` 建新 Release tag（如 `v1.2.1-beta`），上傳 .rbz
4. `powershell -ExecutionPolicy Bypass -Command "vercel --prod"` （從 repo root 執行，Vercel 專案已設 rootDirectory=loamlab_backend）

### Test Coze API
```ruby
ruby test_coze_api.rb
ruby test_coze_stream.rb
```

### Admin: Fix Point Anomalies
```
GET https://loamlab-camera-backend.vercel.app/api/fix_anomalies?key=<ADMIN_KEY>
```

---

## Multi-Agent 協作（模組 → 檔案速查）

Commit message 格式：`feat(ui): 說明 [T07][DONE]`（`[T\d+][DONE]` 觸發 `scripts/sync_tasks.sh` 自動更新 TASKS.md）

| 模組 | 負責檔案 |
|---|---|
| 支付 | `loamlab_backend/api/webhook.js`, `loamlab_plugin/ui/app.js`（LS_VARIANTS 部分）|
| 渲染後端 | `loamlab_backend/api/render.js` |
| 用戶/點數 | `loamlab_backend/api/user.js`, `loamlab_backend/api/referral.js` |
| Plugin UI | `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/index.html`, `loamlab_plugin/ui/i18n.js` |
| Plugin 核心 | `loamlab_plugin/main.rb`, `loamlab_plugin/coze_api.rb` |
| 版本/更新 | `loamlab_plugin/updater.rb`, `loamlab_backend/api/version.js` |

---

## i18n 規則

新增 UI 字串時同時補全 6 種語言（`zh-TW`/`en-US`/`zh-CN`/`es-ES`/`pt-BR`/`ja-JP`）；無翻譯時複製 `en-US` 值佔位。在 `app.js` 用 `t('key')`，禁止 hardcode 中文或在有子元素的 div 上用 `data-i18n`。

驗證：`Object.keys(UI_LANG).forEach(l=>{const m=Object.keys(UI_LANG['en-US']).filter(k=>!(k in UI_LANG[l]));if(m.length)console.warn(l,'missing:',m);});`

---

## 文件同步規則（Doc Sync Protocol）

每次 commit 後，對照下表自動判斷：明確匹配 → 直接同步並在 commit message 標注「已同步 [文件名]」；跨多條目 → 詢問用戶確認。

| 改動類型 | 需同步的文件 |
|---------|------------|
| 點數定價、扣款邏輯 | `POINTS_SYSTEM.md` |
| 新功能上線、Phase 推進 | `PRODUCT_PLAN.md` / `roadmap.md` |
| 版本號更新、Release 發布 | `AGENTS_CHECKLIST.md`、`version.js` |
| 後端 API 新增/修改端點 | `CLAUDE.md`（Architecture 章節）|
| 付費/Webhook 邏輯 | `Summon_Billing.md` |
| 環境變數新增或移除 | `CLAUDE.md`（Environment Variables 章節）|
| 每次 commit 後 | `memory/project_changelog.md`（在「待彙整」追加一行條目）|
| 執行「發佈更新」完畢後 | `memory/project_changelog.md`（清空待彙整，歸入版本區塊；生成 Release 摘要）|
| 新工具上線、功能開放公測 | `loamlab_plugin/PRODUCT_SPEC.md`（工具總覽表格）＋ `loamlab_backend/public/index.html` FeaturesConfig（live 狀態、名稱、描述）|
| 點數定價變動 | `loamlab_plugin/PRODUCT_SPEC.md`（點數系統表格）|

---

## Key Constraints

- **Backend uses Node.js 18+ native `fetch`** — do NOT `require('node-fetch')` (CJS/ESM conflict)
- **`config.rb` in repo** is always `ENV_MODE = "production"` — set to `"development"` manually for local testing
- **Webhook signature**: HMAC-SHA256 with `X-Signature` header; must disable Vercel's `bodyParser`
- **Points waterfall**: deduct `points` first → `lifetime_points`; refund on ANY failure
- **Image hosting**: freeimage.host → fallback ImgBB → both fail = refund + abort
- **Resolution cost detection**: `render.js` string-searches payload for `1K`/`2K`/`4K` — keep strings consistent front/back
- **`fix_anomalies.js`**: CJS/ESM mixed bug (`require()` + `export default`) — avoid touching until refactored
- **Inpainting (`inpaint.js`)**: currently Fal.ai; alternatives: Vertex AI Imagen 3 (mask support, $0.02/img) or Gemini API (text-only, no mask). See `docs/api/GOOGLE_AI_STUDIO_API.md`
- **AtlasCloud Nano Banana 2**: T2I + style transfer only, NO masking/inpainting. Pricing: 1K=$0.072, 2K=$0.108, 4K=$0.144. Docs: `docs/api/ATLASCLOUD_API.md`

---

## External AI API Reference

| API | 用途 | 認證方式 | 詳細說明 |
|-----|------|---------|---------|
| Coze Workflow | 主力渲染（現有）| `COZE_PAT` | `render.js` |
| AtlasCloud Nano Banana 2 | 備援渲染 / 多參考圖風格遷移 | `ATLASCLOUD_API_KEY` | `docs/api/ATLASCLOUD_API.md` |
| Gemini API (AI Studio) | Coze fallback 候選 | `GEMINI_API_KEY` | `docs/api/GOOGLE_AI_STUDIO_API.md` §二 |
| Vertex AI Imagen 3 | Inpainting（Fal.ai 替換候選）| Service Account JSON | `docs/api/GOOGLE_AI_STUDIO_API.md` §三 |
| Fal.ai | Inpainting（現有）| 內建 | `inpaint.js` |

---

## Environment Variables (`loamlab_backend/.env.local`)

| Variable | Used by | Notes |
|---|---|---|
| `SUPABASE_URL` | all | |
| `SUPABASE_ANON_KEY` | `render.js`, `user.js`, `stats.js` | |
| `COZE_PAT` | `render.js` | Coze Personal Access Token |
| `WORKFLOW_ID` | `render.js` | Coze Workflow ID (fallback hardcoded in code) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | `webhook.js` | HMAC signing secret |
| `IMGBB_API_KEY` | `render.js` | Fallback image host; hardcoded default exists |
| `ADMIN_KEY` | `fix_anomalies.js` | Guards admin endpoint in production |
| `SUPABASE_SERVICE_ROLE_KEY` | `render.js` | **Tool 2 必需**；Supabase Storage 私有 bucket 上傳（render-temp）；缺少時 fallback 到 base64 直傳，但建議設置以減少 payload 大小 |
| `ATLASCLOUD_API_KEY` | 備援渲染（未實裝）| `docs/api/ATLASCLOUD_API.md` |
| `GEMINI_API_KEY` | Gemini fallback（未實裝）| Google AI Studio |
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI Inpainting（未實裝）| Service Account JSON 路徑 |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI Inpainting（未實裝）| GCP 控制台取得 |
