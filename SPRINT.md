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

status: READY_FOR_CLAUDE

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
