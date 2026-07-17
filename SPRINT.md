# SPRINT.md

## CONTEXT_DIGEST
- 用戶回報 `loamlab_plugin/ui/app.js` 發生 `IndexSizeError: Failed to execute 'arc'` 錯誤，原因為半徑給予負值 (-0.264062)。
- 錯誤發生在 5810 行 `_scPlayCloseGlow` 特效渲染時。
- 主因為 `requestAnimationFrame` 傳入的 `now` 可能略小於事先由 `performance.now()` 取得的 `start`，導致 `t` 算出來是負數。

## TASKS

### TASK 1: 修復負半徑導致的 arc 繪製錯誤
- **優先級**: [MUST]
- **影響檔案**: `loamlab_plugin/ui/app.js`
- **描述**: 修改 `_scPlayCloseGlow` 函數內的 `t` 值計算，確保 `t` 的值在 0 到 1 之間。請使用 `Math.max(0, ...)` 來避免 `(now - start)` 為負數時產生的負半徑問題。

- [x] TASK 1 完成：`app.js:5776` 的 `t` 計算補上 `Math.max(0, ...)` 下界保護。

status: DONE
