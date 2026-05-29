# SPRINT: Vercel 413 Payload Too Large 錯誤優化

## CONTEXT_DIGEST
- **問題根源**：SketchUp 渲染時截取的圖片轉換為 Base64 後，體積超過 Vercel Serverless Function 的 4.5MB 限制，導致 Vercel 回傳 `413 Request Entity Too Large` 的純文字錯誤。
- **錯誤現象**：Ruby 端預期回傳 JSON，但在解析純文字錯誤時觸發 `JSON::ParserError` (`783: unexpected token...`)，最終被回報系統記錄為 `unknown` 錯誤碼。
- **當前進度**：已在 `loamlab_plugin/main.rb` 的 `sanitize_error` 方法中加入對 `FUNCTION_PAYLOAD_TOO_LARGE` 的捕捉，並回傳友善錯誤提示。

## TASKS

### 1. 強化 Ruby 端的 API 回應解析與錯誤捕捉 [MUST]
- [x] 在 `loamlab_plugin/main.rb` 發送 API 請求後（約在 `batch_export_scenes` 及其他有呼叫 `JSON.parse` 的地方），在執行 `JSON.parse` 前先檢查 HTTP Status Code。若為 413，直接拋出明確的 payload too large 錯誤，避免觸發 `JSON::ParserError`。
- **影響檔案**：`loamlab_plugin/main.rb`

### 2. 優化圖片輸出品質與壓縮機制 (防範機制) [NICE]
- [x] 實作 `write_image_capped`（截圖後 file_size > 1.5MB 自動降質重試）、`read_and_maybe_compress`（本地大圖用 ImageRep 縮圖）、payload guard（組裝後 bytesize > 4.2MB 迭代縮圖），共 3 層防線，用戶無感知。
- **影響檔案**：`loamlab_plugin/main.rb`

status: DONE
