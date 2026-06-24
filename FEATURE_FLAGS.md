# FEATURE_FLAGS.md
# ⚠️ AGENTS: 執行任何 release 前 MUST 讀此檔。pre_release_check.ps1 會機器解析本表。

## Status 定義

| Status | 意義 | release 行為 |
|--------|------|-------------|
| `wip` | 開發中，代碼存在但未完成/未測試 | **BLOCK** — 不得進入 release package |
| `dev-only` | 代碼已在 main，UI 被 gate 鎖住，刻意不對外開放 | **WARN** — 確認 gate 仍有效即可 release |
| `ready` | 功能完整已測試，等待下次 release | ALLOW |
| `released` | 已上線 | 無限制 |

---

## Feature Registry

| Feature | Status | BLOCKED_FILES | Release Criteria | Notes |
|---------|--------|---------------|-----------------|-------|
| `dunning_process` | `released` | — | — | v1.4.50 上線；supabase Phase 28 migration 需確認已執行 |
| `loam_recipes` | `wip` | — | Plugin UI 重新實作後開放（commit 703df94 移除 UI，後端 API 已 deployed 無需 block）| 後端 API 已上線（list_recipes / create_recipe / handleRecipeRemix），Plugin UI 尚未重新建立 |
| `system_bundles` | `wip` | — | Phase B 完整實作後（admin UI 完成 + 插件端 Bundle Bar 完成）| 尚未開始實作，無 WIP 代碼需要 block |

---

## 規則（Agent Instructions）

1. **開始任何 release 流程前**：讀此檔，確認無 `wip` 功能的 BLOCKED_FILES 出現在 `git diff`
2. **新增 WIP 功能時**：同一個 commit 必須同步更新此表（status=`wip`，填入 BLOCKED_FILES）
3. **功能開發完成**：更新 status 為 `ready`，清空 BLOCKED_FILES（填 `—`）
4. **功能上線後**：更新 status 為 `released`，在 Notes 記錄版本號
5. `pre_release_check.ps1` 自動機器解析本表，agent 不需要手動判斷
