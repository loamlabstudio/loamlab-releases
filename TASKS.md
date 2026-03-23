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
| T05 | 反饋系統 | 建立完整反饋收集系統：feedback table + API、渲染後 Rating Bar（👍/👎 + 差評標籤）、錯誤一鍵回報、Beta Feedback modal 替換 mailto、render.js 記錄 plugin_version/transaction_id | `loamlab_backend/supabase_setup.sql`, `loamlab_backend/api/feedback.js`, `loamlab_backend/api/render.js`, `loamlab_plugin/main.rb`, `loamlab_plugin/ui/app.js`, `loamlab_plugin/ui/i18n.js`, `loamlab_plugin/ui/index.html` | `[DONE]` | `main` |
| T06 | 素材庫/SWAP | Phase 1-2 全部落地：F1~F4 + 筆刷效能 + 雲端同步 + 分級上限 + Prompt 翻譯 + inpaint result card 補全 SWAP/EXTRACT 迭代按鈕 | `loamlab_plugin/ui/app.js`, `loamlab_backend/api/materials.js`, `ROADMAP.md` | `[DONE]` | `main` |
| T07 | 反饋系統驗收 | Supabase 執行 feedback table 新 SQL 段落 + SketchUp 熱重載驗收（Rating Bar 顯示、錯誤回報按鈕） | `loamlab_backend/supabase_setup.sql`（執行，不改代碼） | `[OPEN]` | — |
| T08 | Plugin UI | 工具 3 九宮格鏡頭：UI 骨架（Shot Style 選擇器 + 九宮格 Loading 佔位）+ Coze Workflow 串接 | `loamlab_plugin/ui/app.js`, `loamlab_backend/api/render.js` | `[OPEN]` | — |
| T09 | 渲染後端 | 工具 2 局部換裝：In-painting 後端整合（Fal.ai flux-pro/v1/fill）+ 點擊座標格式（x_ratio/y_ratio）驗證 | `loamlab_backend/api/render.js`, `loamlab_plugin/ui/app.js` | `[OPEN]` | — |
| T10 | Plugin UI | UX 修復：儲存多層目錄自動建立（FileUtils.mkdir_p）+ 場景預設全選 + 消除 native alert → showUpdateToast | `loamlab_plugin/main.rb`, `loamlab_plugin/ui/app.js` | `[DONE]` | `main` |
| T11 | 支付 | webhook.js 清理：① 統一環境變數為 LEMONSQUEEZY_WEBHOOK_SECRET（移除 LEMON_WEBHOOK_SECRET fallback）② 確認並移除 referral 殘留發點邏輯（舊 200+200，已由 render.js B+100/A+300 取代） | `loamlab_backend/api/webhook.js` | `[OPEN]` | — |
| T12 | 用戶/點數 | fix_anomalies.js CJS/ESM 修復：require() → import，dev 環境補 ADMIN_KEY 驗證（PRODUCT_PLAN.md §8 技術債，工具 4 開發前必修） | `loamlab_backend/api/fix_anomalies.js` | `[OPEN]` | — |
| T13 | Plugin UI | i18n.js 補全缺失 key：res_1k/2k/4k（index.html 已引用但未定義，視覺空白 bug）+ 驗證 SWAP/Extract key 中英文完整 | `loamlab_plugin/ui/i18n.js` | `[OPEN]` | — |
| T14 | 反饋系統 | feedback.js 品牌修正：郵件模板殘留「野人相機」→「LoamLab AI Renderer」 | `loamlab_backend/api/feedback.js` | `[OPEN]` | — |

---

## 整合佇列（DONE 後等待合併）

> 所有 `[DONE]` 的任務在這裡等待 merge 到 main，然後統一 build + release。

- [x] T05 — 反饋系統（main）— ✅ 已部署 vercel --prod（2026-03-22）；待：T07 驗收完成後進入發布前清單
- [x] T06 — 素材庫/SWAP Phase 1-2（main）— ✅ 已部署 vercel --prod（2026-03-23）
- [x] T10 — UX 修復（main）— ✅ 已 commit（2026-03-23）

---

## 發布前清單（每次 Release 前 reset，逐步打勾）

| 步驟 | 狀態 |
|---|---|
| T07 驗收完成（Supabase SQL + SketchUp 熱重載） | [ ] |
| `build_rbz.ps1` 打包 `.rbz` | [ ] |
| 更新 `version.js` 版本號 | [ ] |
| `release.ps1` 上傳 GitHub Release | [ ] |
| `vercel --prod` 部署後端 | [ ] |

---

## 規則（4 條）

1. **開 session → 先讀此文件** → 認領一個 `[OPEN]` 任務，改為 `[ACTIVE]`，填入 branch 名
2. **只碰「檔案範圍」欄位列出的文件** — 其他 session 的範圍絕對不碰
3. **完成 → 改狀態為 `[DONE]`** → 把 branch 名填入整合佇列
4. **完成 → commit 前對照 CLAUDE.md § Doc Sync Protocol 確認文件同步**
