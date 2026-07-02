# SPRINT

## CONTEXT_DIGEST
近期發生單次充值 (`TOPUP_SINGLE`) 點數未發放且未拋錯的嚴重 Bug，起因於 `lib/activate.js` 中三元表達式的邏輯漏洞。此外，部分 Apple Pay 產生的匿名信箱訂單因無法匹配用戶，導致 Webhook 處理失敗且未能妥善留存稽核紀錄。為了徹底杜絕此類金流異常，需優化點數計算的防禦性驗證機制，並建立無主訂單（Unclaimed Payments）的容錯與追蹤架構。

## TASKS

1. **[MUST] 強化 `processTopup` 的防禦性驗證 (Defensive Programming)**
   - **影響檔案**：`loamlab_backend/lib/activate.js`
   - **描述**：在計算完 `updatePayload.points` 後、實際呼叫 Supabase 寫入前，加入嚴格的斷言（Assertions）。若為 `TOPUP_SINGLE`，驗證計算後的點數必須**大於**原始點數；若點數出現不合理的下降或不變，立即拋出自定義錯誤（如 `PointCalculationError`），阻止寫入並觸發後續錯誤日誌。

2. **[MUST] 實作無主訂單 (Unclaimed Payments) 的攔截與記錄機制**
   - **影響檔案**：`loamlab_backend/api/webhook.js`
   - **描述**：當 `payment.succeeded` 收到成功付款，但 `customerEmail` 缺失、為 Apple Pay 匿名信箱、或無法在資料庫中關聯到實體 `users` 時，不應直接丟棄或僅拋出 500 錯誤。需將該筆金流以 `status: 'unclaimed'` 的形式強制作為特殊日誌存入 `webhook_errors`（或透過新增欄位標記），以便客服後續手動歸戶。
   - **依賴**：無。

3. **[NICE] 引入原子化檢查或事務機制 (Atomic DB Operations)**
   - **影響檔案**：`loamlab_backend/lib/activate.js`, `loamlab_backend/api/webhook.js`
   - **描述**：目前點數更新 (`users` 表) 與交易紀錄 (`transactions` 表) 是兩次獨立的 API 呼叫。為防止 Race Condition 或中斷導致資料不一致，應優化錯誤處理區塊 (Error Boundary)，若 `transactions` insert 失敗（非 unique constraint），嘗試回滾或發送重大告警；長遠可考慮移至 Supabase RPC 處理。
   - **依賴**：需先完成 TASK 1 確保應用層邏輯無誤。

status: DONE
