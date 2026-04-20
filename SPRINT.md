# LoamLab 行動分享與後台管理升級 SPRINT

## CONTEXT_DIGEST
解決三大痛點：1. 後台管理與預覽邏輯斷裂；2. 前台分享碼易被反推後台提示詞邏輯；3. 行動端 IG 分享流程繁瑣。
優化方向：採用 Session 隔離加密、Web Share API 圖文聯動、以及可編輯的 JSON 提示詞沙盒。
詳見：[implementation_plan.md](file:///c:/Users/qingwen/.gemini/antigravity/brain/34872013-50fb-4384-8ad0-d0432b25639a/implementation_plan.md)

## TASKS
- [x] 1. **整合預覽與手動編輯**：admin.html 預覽區加 👁/✏️ 切換，編輯模式可直接改 JSON + 「▶ 套用」測試。
- [x] 2. **靜默提示詞 (Hidden Nodes)**：`hidden: true` 節點紫色標識，admin 可 🙈 切換，plugin UI 過濾不顯示，render.js 繼續合併送出。
- [x] 3. **分享加密與邏輯防禦**：Session Hash 機制已就緒（stats.js + qr-handoff.html + app.js 均已實裝，T3 在上一版已完成）。
- [x] 4. **一鍵圖文分享 (Mobile UI)**：qr-handoff.html 加入 navigator.share 原生分享（圖片打包為 File），fallback 舊流程。
- [x] 5. **後台 UI 降噪優化**：系統層提示加琥珀色區塊標頭，用戶控制項加青色區塊標頭，hidden 節點紫色。

status: DONE
