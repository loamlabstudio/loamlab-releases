# SPRINT: 優化 Paywall Trigger 反饋信件具體資訊

## CONTEXT_DIGEST
當使用者觸發付費牆 (`paywall_trigger`) 時，前端 (`loamlab_plugin/ui/app.js`) 已經將當下的所需點數 (`cost`) 與餘額 (`balance`) 附加在 `metadata` 內傳遞給後端。但後端的 Email 發送邏輯 (`loamlab_backend/api/feedback.js`) 在組裝信件時，遺漏了這些非預設的 metadata，導致管理員收到內容為空的無效通知。

## TASKS

1. **[x] 更新後端 Feedback 信件模板動態萃取 Metadata**
   - **影響檔案**: `loamlab_backend/api/feedback.js`
   - **描述**: 修改 `sendEmailNotification` 函式，檢查 `metadata` 物件中是否有尚未被標準信件模板（如 `plugin_version`, `resolution`, `error_code`）使用的鍵值對。若有，則將這些額外數據（如 `cost` 和 `balance`）動態格式化，並附加在原本 Email `text` 陣列的最後面（如新增「附加數據：...」區塊），確保後續任何新增的自定義事件數據都能完整呈現於通知信中。

status: DONE
