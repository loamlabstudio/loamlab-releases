# Sprint: 預覽截圖出錯修復 (Hotfix Release)

## CONTEXT_DIGEST
- 用戶遇到 `Filename not specified` 錯誤，起因為 Windows 中文用戶名導致 `Dir.tmpdir` 產生非 UTF-8 的路徑編碼錯誤。
- Antigravity 已完成核心修復：在 `main.rb` 引入 `LoamLab.safe_temp_dir` 並替換了所有 `Dir.tmpdir` 的呼叫（包含 `updater.rb`）。
- **極度重要警示**：這是一個緊急補丁 (Hotfix) 上線。目前專案內可能存在正在開發中的「SaaS 訂閱扣款失敗處理機制 (Dunning Process)」相關後端或前端代碼。**絕對不能**將未開發完成的內容一起打包或部署上線。

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/config.rb
  - loamlab_plugin/main.rb
  - loamlab_plugin/updater.rb
sql_migration: false

## TASKS
- [MUST] **Task 1: 版本號更新與修改確認**
  - **影響檔案**: `loamlab_plugin/config.rb`
  - **描述**: 將 `config.rb` 的 `VERSION` 推進一個小版號（如 `1.4.49` -> `1.4.50`）。快速核對 `main.rb` 與 `updater.rb` 的 `safe_temp_dir` 補丁邏輯無誤。
- [MUST] **Task 2: 隔離未完工代碼與打包插件**
  - **影響檔案**: `loamlab_plugin/*` (打包目標)
  - **描述**: 將本地「尚未開發完成的 Dunning Process 代碼」進行 `git stash` 暫存隔離。接著打包最新的 `loamlab_plugin` 資料夾為 `.rbz` 安裝檔。
- [MUST] **Task 3: 安全部署與版本發布**
  - **影響檔案**: `loamlab_backend/api/*` (負責版本更新的 endpoint)、Vercel 部署
  - **描述**: 僅針對「插件更新所需的版本宣告邏輯」進行更新並發布上線。部署完畢確認新版 `.rbz` 可供下載後，透過 `git stash pop` 還原原本正在開發的 Dunning Process 相關代碼。

status: DONE
