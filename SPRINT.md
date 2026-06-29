# Sprint Plan: 訂閱升降級體驗優化與 Webhook 安全性檢查

## CONTEXT_DIGEST
用戶希望在開啟 Customer Portal 自助升降級功能時，確保用戶體驗良好且系統邏輯絕對安全。當前截圖顯示的設定有隱患（特別是降級立刻生效會吃掉用戶剩餘權益）。需要調整平台設定，並確保後端 webhook 能穩妥處理 `subscription.updated` 或升降級觸發的點數結算，防止漏洞或重複發放。

## TASKS

- [x] **TASK 1: 優化金流後台自助服務設定 (平台設定指南)**
  - **影響檔案**: 無（需手動在 Stripe/Dodo Dashboard 設定）
  - **描述**: 
    1. 將 **Allow Multiple Subscriptions** 設為 `OFF`，防止重複訂閱。
    2. **Upgrade (升級)** 設定：`When the new plan starts` 設為 **Immediately**（讓用戶立刻享受高級功能），`How the customer is charged` 設為 **Difference immediately**（或 Prorated immediately，即立刻補差價）。
    3. **Downgrade (降級)** 設定：`When the new plan starts` 必須改為 **At end of billing period**。保障用戶已付費週期的權益，避免月中降級被「立刻」扣低級方案費用而引發客訴。
  - **優先級**: [MUST]

- [x] **TASK 2: 擴充 Webhook 處理升降級事件 (`subscription.updated`)**
  - **影響檔案**: `loamlab_backend/api/webhook.js`, `loamlab_backend/lib/activate.js`
  - **描述**: 
    1. 檢查並實作 `subscription.updated` (或金流對應事件) 的處理邏輯。
    2. 當用戶升級時（補差價），會觸發新的 payment 或 update 事件，需確保 `processTopup` 能正確識別方案變更並發放升級對應的點數，同時避免與原本訂閱週期的點數衝突（冪等性檢查）。
    3. 當用戶降級時（通常設為期末生效），確保資料庫在下一週期續約時，正確同步為新的 `subscription_plan`。
  - **優先級**: [MUST]

- [x] **TASK 3: 優化前端方案狀態顯示 (可選)**
  - **影響檔案**: `loamlab_plugin/ui/app.js` (或相關 UI 組件)
  - **描述**: 若用戶進行了「期末降級」，金流端會標記為 downgrade_pending，視需要在 UI 上提示用戶「您的方案將於 X 月 X 日降級至 [新方案]」，提升用戶預期心理與體驗。
  - **優先級**: [NICE]

status: DONE
