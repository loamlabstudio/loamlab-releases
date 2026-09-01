# Implementation Plan

## Bug Analysis: Smart Canvas "Right 1/3" Annotation Issue (v1.4.70)
**Root Cause:**
In v1.4.70, we capped the internal canvas resolution to 1920px, which eliminated the CEF max texture size limit crash. However, the right 1/3 bug still occurs.
The true root cause is a classic SketchUp CEF bug related to Windows High-DPI scaling (e.g., 125%, 150% display scaling).
In some older versions of CEF embedded in SketchUp, when display scaling is active, `e.clientX` (which returns physical pixels) and `element.getBoundingClientRect()` (which returns CSS pixels) use mismatched coordinate units.
In `_scGetXY`, we calculate `x = Math.round((clientX - rect.left) * scaleX)`. Because `clientX` grows 1.5x faster (at 150% scaling) than `rect.width`, the calculated `x` reaches the right edge of the canvas when the physical mouse is only at the 66% (2/3) mark. If the mouse moves further into the right 1/3, `x` exceeds `canvasW`, the cursor is drawn out of bounds (disappears), and clicks are registered off-canvas.

**Solution:**
Replace `e.clientX - rect.left` with `e.offsetX` and `e.target.clientWidth`. `offsetX` and `clientWidth` are properties of the same element and use the exact same unit, completely immunizing the coordinate mapping from CEF DPI scaling bugs.

## TASKS

### TASK 1: Fix High-DPI Mouse Mapping in `_scGetXY` [MUST]
**影響檔案**: `loamlab_plugin/ui/app.js`
- Locate the `_scGetXY(e)` function.
- Add logic to preferentially use `e.offsetX` and `e.offsetY`:
  ```javascript
  if (e.offsetX !== undefined && e.offsetY !== undefined && e.target) {
      const scaleX = SmartCanvas.canvasW / e.target.clientWidth;
      const scaleY = SmartCanvas.canvasH / e.target.clientHeight;
      return {
          x: Math.round(e.offsetX * scaleX),
          y: Math.round(e.offsetY * scaleY)
      };
  }
  ```
- Keep the existing `clientX / getBoundingClientRect()` logic as a fallback for touch events (`e.touches`).

### TASK 2: Update Version to 1.4.71 (Client Official Release) [MUST]
**影響檔案**: `loamlab_plugin.rb`, `loamlab_plugin/config.rb`, `loamlab_backend/api/version.js`
- Bump the version string from `1.4.70` to `1.4.71` across the client config and the backend API.
- Ensure `download_url` in `version.js` reflects `v1.4.71`.

status: DONE
# 執行摘要（2026-09-01）：
# - T1 完成：_scGetXY 滑鼠事件改用 e.offsetX/offsetY + e.target.clientWidth/clientHeight
#   （事件綁在 draw-canvas、上層 canvas pointer-events:none，e.target 恆為 draw-canvas，
#    offset 與 clientWidth 同源自洽，對 CEF High-DPI clientX 單位錯亂免疫）；加 clientWidth>0
#    guard；touch 事件維持舊 getBoundingClientRect 換算。node --check 通過。
# - T2 完成：版本 1.4.71（config.rb / loamlab_plugin.rb / version.js latest_version + download_url）。
# - 附帶（經用戶確認一起發）：main.rb poll_render_task 逾時 100→300 次（5→15 分鐘）、
#   .gitignore 補本機除錯/PII/.env 忽略規則。
# - Release Gate PASS（ESLint ES2019 OK / WIP 無外洩 / 版本三方同步 / 無 SQL migration）。
#   Check 3 的 6 個 WARN 為假警報：verified_diff 檔名後帶 # 註解導致整行字串比對失配，檔案實際都在 diff。
# - 已發佈：GitHub Release v1.4.71 + Vercel prod + tag v1.4.71。
# - 殘留：Windows 150% 顯示縮放實機「右 1/3」驗證待用戶熱重載確認（不阻擋發佈）。
#   本機 origin/main 落後 4 個 commit（含發佈前既有 2 個），publish.ps1 只推 tag 不推分支，待用戶決定是否 push。

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_plugin/ui/app.js          # T1: _scGetXY High-DPI 座標映射
  - loamlab_plugin/config.rb          # T2: VERSION 1.4.71
  - loamlab_plugin.rb                 # T2: ext.version 1.4.71
  - loamlab_backend/api/version.js    # T2: latest_version + download_url 1.4.71
  - loamlab_plugin/main.rb            # 附帶: poll_render_task 逾時 5→15 分鐘（扣點漏圖修復）
  - .gitignore                        # 附帶: 本機除錯腳本/PII/.env 忽略規則
  - SPRINT.md
sql_migration: false
