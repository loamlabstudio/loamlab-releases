# Sprint Plan: 輪廓粗細線（Profiles & Silhouettes）全面支援編輯

## CONTEXT_DIGEST
管理員希望在後台不僅能調整最外圈的「剪影輪廓線 (Silhouettes)」，也能對模型內部的「物件輪廓線 (Profiles)」進行粗細編輯。
此 Sprint 將在強制渲染與 T4 專屬樣式中引入 DrawProfiles 與 ProfileWidth 屬性，同時優化後台界面，消除概念混淆，實現完整的粗細線可編輯控制。

## TASKS

- [x] **TASK 1: 在後台界面加入物件輪廓線（Profiles）與粗細控制**
  - **影響檔案**: `loamlab_backend/public/admin.html`
  - **描述**: 
    1. 在 `renderRenderForceStyleSection` 與 `renderT4ForceStyleSection` 的 Edge Style 區塊中，分開列出「剪影輪廓線 (DrawSilhouettes / SilhouetteWidth)」與「物件輪廓線 (DrawProfiles / ProfileWidth)」開關與粗細輸入欄。
    2. 在 `_updateT4ForceStyleField` 中將 `DrawProfiles` 等新增的 boolean 屬性納入型態轉換白名單，防止轉換成 NaN。
  - **優先級**: [MUST]

- [x] **TASK 2: 在插件核心中套用與備份物件輪廓線參數**
  - **影響檔案**: `loamlab_plugin/main.rb`
  - **描述**: 
    1. 在 `RENDER_KEYS` 預設樣式中，新增 `'DrawProfiles' => true` 與 `'ProfileWidth' => 2` 的預設值。
    2. 在 `apply_force_style_override` 裡的 `ro_keys` 陣列中補上 `'DrawProfiles'` 與 `'ProfileWidth'`，確保渲染時能正確套用。
    3. 在 `sync_preview` 的 `_sync_save` lambda 中新增此二鍵，確保同步預覽時的還原不影響用戶本機原始模型視角。
  - **優先級**: [MUST]

- [x] **TASK 3: 本地驗證與打包**
  - **影響檔案**: `build_rbz.ps1`
  - **描述**: 執行 `powershell -ExecutionPolicy Bypass -File build_rbz.ps1 -Force` 進行測試打包，確保 UI 代碼無 ESLint 語法錯誤並成功生成 `loamlab_plugin.rbz`。
  - **優先級**: [MUST] (依賴 TASK 1、TASK 2)

status: DONE
