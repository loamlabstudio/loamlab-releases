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

### Commit 觸發的後端自動部署（本機 hook，非本 repo 文件所控）
`main` 分支上每次 `git commit` 會經由 `.claude/settings.local.json` 的 PostToolUse hook 觸發
`scripts/auto_deploy_gate.sh`：先檢查分支是不是 main、再跑 `pre_release_check.ps1`
（WIP 外洩/版本同步檢查），都過了才真的 `vercel --prod`。結果一律寫進專案根目錄
`auto_deploy.log`（已加入 `.gitignore`，純本機除錯用）。
`.claude/settings.local.json` 本身是個人本機設定，不由 agent 編輯/commit——內容變更需要
用戶自己在編輯器裡動手，改完要在 Claude Code 對話框輸入 `/hooks` 才會重新載入設定。

### Release New Version（三步，說「發佈更新」直接執行不再詢問）
1. 版本號遞增（patch +1），同步 `config.rb` (`VERSION`) / `loamlab_plugin.rb` (`ext.version`) / `loamlab_backend/api/version.js` (`latest_version`) → commit
2. `powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1"` （含 ESLint 語法檢查，失敗即中止）
3. `powershell -ExecutionPolicy Bypass -File ".\publish.ps1"` （GitHub Release 上傳 + Vercel 部署，一步完成）

> `release.ps1` 已廢棄，勿使用。

### Branch Strategy（分支規則）

| 分支 | 職責 |
|------|------|
| `main` | 已上線版本，隨時可打包部署 |
| `dev` | 開發中功能，功能完成再 merge 到 main |

**護欄：** `build_rbz.ps1` 和 `publish.ps1` 在非 `main` 分支執行會 abort（`build_rbz.ps1 -Force` 可強制執行，僅限測試用）。

**緊急修復（用戶回報 bug 時）：**
```powershell
git checkout main                         # 切到乾淨的已上線版本
# 修改 bug + git add + git commit -m "fix: ..."
# 版本號 +1（config.rb / loamlab_plugin.rb / version.js）
git commit -m "chore: bump version to x.x.x"
powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1"
powershell -ExecutionPolicy Bypass -File ".\publish.ps1" -notes "fix: 說明"
git checkout dev; git merge main          # 把修復同步回 dev
```

**功能完成發布：**
```powershell
# 在 dev 分支完成測試後
git checkout main
git merge dev --no-ff -m "feat: [功能名] vX.X.X"
# 版本號 +1，然後走正常三步發布流程
git checkout dev; git merge main          # 保持 dev 同步
```

**測試用打包（在 dev 分支本地測試，不 release）：**
```powershell
powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1" -Force
```

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

## Release Gate Protocol

**每次 release 前 agent 必須遵循。`build_rbz.ps1` 已自動整合 `pre_release_check.ps1`。**

### 上線類型判斷

| 類型 | 觸發條件 | 允許的 diff 範圍 | QA 要求 |
|------|---------|----------------|---------|
| `hotfix` | bug 修復、文字修正、小調整 | 僅 bug 相關檔案 | 快速驗收即可 |
| `feature` | 新功能、大幅 UI 改動、新 API | 包含多個模組 | 完整測試 + `verified_diff` 必填 |

### Agent 決策樹

```
收到「上線/發佈/release」指令
  → 1. 讀 FEATURE_FLAGS.md
       └─ 有 wip 功能的 BLOCKED_FILES 在 git diff 中？→ STOP，詢問用戶如何隔離
       └─ ⚠️ BLOCKED_FILES 只比對 main 自己的 diff，管不到還沒 merge 進來的 dev 分支內容。
          若這次 release 包含 `git checkout main; git merge dev`，必須額外逐一讀
          FEATURE_FLAGS.md 每個 wip/dev-only 項目的 Notes，人工確認 dev 上對應功能真的做完了
          （細節見 FEATURE_FLAGS.md「⚠️ 跨分支 WIP」章節）；沒做完就用 git cherry-pick 只挑
          乾淨 commit，不要整支 dev 一次 merge
  → 2. 確認 SPRINT.md 有 ## RELEASE_GATE 區塊（release_type + verified_diff）
       └─ 若無 → 請 Gemini 補填或人工確認
  → 3. build_rbz.ps1（內含 pre_release_check.ps1 自動 gate，必須 PASS）
       └─ FAIL → 依錯誤訊息修復，不得用 -Force bypass（除非用戶明確指示）
  → 4. publish.ps1（第三步會自動打 git tag，維持 pre_release_check.ps1 的 diff 基準線準確）
```

### SPRINT.md RELEASE_GATE 區塊格式（每個 Sprint 必填）

```markdown
## RELEASE_GATE
release_type: hotfix          # hotfix | feature
verified_diff:                # 此 release 預期在 diff 中的所有檔案
  - loamlab_plugin/main.rb
  - loamlab_plugin/updater.rb
sql_migration: false          # true = supabase_setup.sql 有新 Phase，需人工執行
```

### FEATURE_FLAGS.md 維護規則（見根目錄 FEATURE_FLAGS.md）

- 新增 WIP 代碼時：同一 commit 更新 FEATURE_FLAGS.md（status=`wip`，填 BLOCKED_FILES）
- 功能完成：status → `ready`，清空 BLOCKED_FILES
- 上線後：status → `released`，Notes 記錄版本號

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

- **Plugin UI (`loamlab_plugin/ui/`) runs in SketchUp's embedded WebView (old CEF/Chromium) — forbidden APIs:**
  - `AbortSignal.timeout()` → use `new AbortController()` + `setTimeout(() => ctrl.abort(), ms)` instead
  - Any Chrome 100+ static method not available as instance method (verify on MDN "Chrome ≥ ?")
- **Never mix `require()` and `export default` in the same `api/*.js` file** — pure ESM (`import`/`export default`) or pure CJS (`require`/`module.exports`) are both fine; mixing causes silent Vercel build failure (entire subdirectory returns 404). Run `powershell -ExecutionPolicy Bypass -File scripts/check_cjs.ps1` before deploying to verify.
- **Vercel Hobby plan: 12 serverless functions maximum** — current count is 12/12 (`api/` = 8 + `api/auth/` = 4). Adding any new `api/*.js` requires removing one first. Run `scripts/check_cjs.ps1` to see current count.
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
| `GOOGLE_CLIENT_ID` | `auth/login.js` | Google OAuth Client ID — Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | `auth/google-callback.js` | Google OAuth Client Secret（同上）|
| `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI Inpainting（未實裝）| Service Account JSON 路徑 |
| `GOOGLE_CLOUD_PROJECT` | Vertex AI Inpainting（未實裝）| GCP 控制台取得 |
| `RESEND_API_KEY` | `stats.js` (`notify_users` action) | Resend 發信 API key；缺少時 notify_users 回傳 503 |
| `RESEND_FROM_EMAIL` | `stats.js` (`notify_users` action) | 發件人地址，預設 `LoamLab <noreply@loamlab.studio>` |
