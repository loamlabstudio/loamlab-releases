# T1 渲染扣點未返圖 (無限 Processing) 修復驗證

## CONTEXT_DIGEST
用戶反映 T1 扣點卻未收到圖片，但 AtlasCloud 後台顯示已成功生成。
經查發現，當 AtlasCloud 的狀態為 `succeeded`，但因為回傳的 JSON 結構變更（特別是 Seedream 模型），導致後端無法正確抓取 `finalUrl`。這會觸發無限 `processing` 狀態，使前端輪詢 5 分鐘後超時，造成扣點未退還。目前 Antigravity 已在 `render.js` 實作修復與退款安全網。

## TASKS

1. **[MUST] 審查 URL 提取邏輯** [x]
   - **影響檔案**: `loamlab_backend/api/render.js`
   - **說明**: 檢查 Antigravity 擴展的 `finalUrl` 提取邏輯（相容 `pData.data.output`, `pData.data.outputs[0].url`, `pData.data.images[0].url` 等結構），確認符合 AtlasCloud 模型 API 規範且無語法錯誤。
   - **結果**: 通過。涵蓋四種常見形狀並對物件做二次解包。殘留風險：若 AtlasCloud 回傳未知欄位名的物件（非 `.url`/`.image_url`），仍會把物件誤當字串塞入，暫無實例可驗證，先記錄觀察。

2. **[MUST] 審查逾時自動退款機制** [x]
   - **影響檔案**: `loamlab_backend/api/render.js`, `loamlab_plugin/ui/app.js`
   - **說明**: 確認新增的退款邏輯（當 `state === 'succeeded'` 且經過 4 分鐘 (240秒) 仍無 URL 時，自動呼叫 `refundAndFail` 退回點數並回傳失敗）是否安全可靠，不會產生非預期的副作用。
   - **結果**: 發現缺陷並已修復。原邏輯完全依賴 AtlasCloud 回應中的 `created_at` 欄位，但該欄位在文件中未被證實存在於輪詢端點回應——若缺失，安全網永遠不觸發，等同沒修好原本「無限 processing 扣點未退」的問題。修復：前端 `_pollRenderTask` 改為自行記錄輪詢起始時間並隨每次請求帶回 `started_at`，後端以此為主要判斷依據，`created_at` 僅作備援。已通過 `node --check` 語法驗證。

3. **[追加] main.rb 主渲染輪詢（tool 1）補上相同修復** [x]
   - **影響檔案**: `loamlab_plugin/main.rb`
   - **結果**: 發現 `app.js` 的 `started_at` 修復只覆蓋 Smart Canvas（tool 2），主渲染（tool 1）走的是 `main.rb` 獨立的 `poll_render_task` Ruby 實作，完全沒傳時間戳記。已補上 `started_at`（`handle_render_response` 首次收到 processing 時記錄），並把「HTTP 200」這種對用戶無意義的錯誤訊息改成誠實提示；判斷邏輯改用 `task_id` 是否存在，不再要求 `status` 剛好等於 `'processing'`。

4. **[追加] saveRenderHistory 改為 await（原 fire-and-forget）** [x]
   - **影響檔案**: `loamlab_backend/api/render.js`
   - **結果**: 用真實生產資料驗證發現 render_history 大量缺漏——Vercel serverless 回應送出後執行環境可能立即凍結，沒 await 的 insert 根本來不及寫入。已修復。

5. **[追加] 新增排程異常掃描安全網** [x]
   - **影響檔案**: `loamlab_backend/api/stats.js`, `loamlab_backend/vercel.json`
   - **結果**: 新增 `scan_render_anomalies` action + 每日 cron（複用 stats.js，不佔新 serverless function 額度，仍 12/12）。用「同用戶扣款 vs. 出圖/退款」時間序列配對找孤兒扣款並自動退款，避免以後又要等客訴才發現。已用 dry-run 對照真實生產資料驗證邏輯正確。

6. **[追加] Dodo Payments 對帳漏洞修復** [x]
   - **影響檔案**: `loamlab_backend/lib/activate.js`
   - **結果**: 追查用戶 hanaxyq@gmail.com 訂閱點數異常時發現：`reconcilePaymentsForEmail` 用 `/payments?customer_email=` 查詢，但這個過濾參數會被 Dodo API 靜默忽略（已知問題，`stats.js`/`user.js` 早有繞過但這支漏改），且沒有讀取 `metadata.planKey` 導致就算抓到對的付款也會被略過。已改用分頁 + client-side 比對，並補上 planKey 判斷。已用真實資料驗證：成功補發 hanaxyq 7/2 漏接的訂閱付款。

7. **[追加] Smart Canvas（T2）畫布互動區域錯位修復** [x]
   - **影響檔案**: `loamlab_plugin/ui/app.js`
   - **結果**: 用戶回報「T2 滑鼠點不到圖片的所有地方」。根因：三層 canvas 的顯示尺寸只在圖片載入當下量測一次，SketchUp 對話框視窗事後縮放時 `<img>` 會跟著流式縮放但 canvas 尺寸不會跟著變，導致點擊座標換算用的是舊尺寸、圖片部分區域點不到。已加 `ResizeObserver` 持續同步 canvas 顯示尺寸。

## RELEASE_GATE
release_type: hotfix
verified_diff:
  - loamlab_backend/api/render.js
  - loamlab_backend/api/stats.js
  - loamlab_backend/lib/activate.js
  - loamlab_backend/vercel.json
  - loamlab_backend/api/version.js
  - loamlab_plugin/main.rb
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
sql_migration: false

status: DONE
