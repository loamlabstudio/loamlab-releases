# SPRINT.md

## CONTEXT_DIGEST
1. Dodo 靜態連結 (`buy/{product_id}`) 會報 404，因為靜態連結必須使用 Payment Link ID (`plink_xxx`)，不能使用 Product ID (`pdt_xxx`)。
2. 官網未帶入折扣碼，因為雖然 Payload 有 `discount_codes`，但前端可能未成功觸發折扣渲染，最佳實踐是直接把 `?discount_code=` 拼接到產生的 `checkoutUrl` 後方。
3. **致命 Bug（付費後未變會員）**：`activate.js` 中有錯誤邏輯 `if (isSubscription && user && user.subscription_plan === null) return;`。這會導致所有「首次訂閱」或「曾退訂後再訂閱」的用戶（其 `subscription_plan` 預設皆為 `null`）在付款成功後被錯誤攔截，完全無法獲得會員權益！
4. **架構重構最佳實踐**：在 Checkout API 建立 Session 時將 `planKey` (如 `PRO`) 寫入 `metadata`；Webhook (`payment.succeeded`) 直接讀取 `metadata.planKey` 並傳給 `processTopup`，徹底解耦多變的 `product_id`，並刪除 `activate.js` 中的錯誤攔截邏輯。

## TASKS

- [MUST] **TASK 1: 重構 Checkout API 邏輯 (Backend)**
  - **影響檔案**: `loamlab_backend/api/user.js`
  - **說明**: 
    1. 在 Dodo API 的 `checkouts` payload 中新增 `metadata: { planKey, email }`。
    2. 成功取得 `checkout_url` 後，如果 URL 尚無折扣碼，手動透過字串拼接補上 `discount_code=LOAM_BETA_30` 參數以強制觸發前端折扣。
    3. 徹底移除無效的 `fallbackUrl` 邏輯，若 API 建立 Session 失敗，直接回傳錯誤，不要回傳帶有 `pdt_` 的假網址。

- [MUST] **TASK 2: 清除前端寫死的 404 Fallback 連結 (Plugin & Website)**
  - **影響檔案**: `loamlab_plugin/ui/app.js`, `loamlab_website/src/app/page.tsx`
  - **說明**: 移除 `DODO_DIRECT_URLS` 與 `PLAN_FALLBACK_URLS` 靜態字典。當呼叫 `/api/user?action=checkout` 失敗或未取得 `checkoutUrl` 時，停止跳轉並透過 Toast / UI 顯示錯誤提示（例如：「無法建立結帳連結，請稍後再試」），絕對不能再跳轉到 `error/not-found`。

- [MUST] **TASK 3: 依賴 Metadata 派發權益 (Webhook)**
  - **影響檔案**: `loamlab_backend/api/webhook.js`
  - **說明**: 在 `payment.succeeded` 的處理邏輯中，優先從 `data.metadata.planKey` 提取方案名稱，並將這個 `planKey` 當作參數傳遞給 `processTopup`。保留對 `customer_email` 的提取。

- [MUST] **TASK 4: 修復與極簡化 Activate 邏輯 (Backend)**
  - **影響檔案**: `loamlab_backend/lib/activate.js`
  - **說明**: 
    1. **【關鍵修復】**：刪除 `if (isSubscription && user && user.subscription_plan === null) { return console.log(...) }` 這段錯誤的攔截邏輯！
    2. 修改 `processTopup` 參數，改為直接接收 `planKey` (如 'STARTER', 'PRO')。根據 `planKey` 直接判定並派發對應點數 (300, 2000, 9000 等)，不再依賴 `IDS` 進行脆弱的 `variantId` / `product_id` 比對，徹底解決 Test/Live 環境 ID 變更導致派發失敗的問題。

status: DONE
