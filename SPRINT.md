# SPRINT.md

## CONTEXT_DIGEST
- 用戶收到郵件系統退信，原因是索取下載連結時，信箱網域誤打成 `gamil.com`（應為 `gmail.com`）。
- 為了避免這類手誤導致潛在用戶流失，需要在後端直接對常見的信箱 typo 進行自動校正。

## TASKS
1. **[x] 在 capture_email 端點實作信箱拼寫自動修正**
   - 說明：於 `capture_email` 接收端點處理 `req.body.email` 時，將字串轉為小寫並去除前後空白，針對常見的 gmail 誤拼（例如 `@gamil.com`, `@gmai.com`, `@gmail.con`）自動替換為正確的 `@gmail.com`，確保後續儲存及發信對象無誤。
   - **影響檔案**：`loamlab_backend/api/stats.js`

status: DONE
