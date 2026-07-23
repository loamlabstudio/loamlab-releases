IyBDT05URVhUX0RJR0VTVArnlb前金流架構使用 Dodo Payments 的 change-plan API 處理升降級，引發了嚴重的業務邏輯與安全性事故。
事故根因：change-plan 會產生「補差價 (Proration)」的畸零付款，這類 Webhook Payload 的 product_cart 為空，且金額不可預測。我們後端的 processTopup 邏輯存在嚴重漏洞：只要 metadata 帶有 planKey: STUDIO 且付款成功，就會「無條件強制覆寫當月點數為 9000」，這導致用戶只要花 1 美元的補差價，就能無限次將點數洗回 9000 滿血狀態。
重構第一性原理：徹底廢棄所有「按比例補差價」與「依賴單一訂閱變更」的邏輯。用戶每次購買/升級方案，都必須走全新的 /checkouts 流程並支付全額，以當天作為新計費週期的第一天。同時，後端必須嚴格校驗付款金額與點數的對應關係。所有受害者已完成手動補發與致歉，接下來必須從源頭重構。

# TASKS

1. **[MUST] 廢除 change-plan 補差價邏輯，改為全額新訂閱**
   - 描述：修改 Checkout API。當既有訂閱者購買新方案時，**嚴禁**呼叫 Dodo 的 change-plan API。改為像全新用戶一樣，直接產生全新的 /checkouts 連結。這會讓用戶支付全額，並建立一個擁有完整 30 天週期的新訂閱 (Subscription)。
   - 影響檔案：loamlab_backend/api/user.js

2. **[MUST] 新訂閱生效時，自動取消所有舊訂閱**
   - 描述：當 Webhook 處理 subscription.active 或 payment.succeeded 時，若成功發放點數，需檢查該用戶在資料庫中是否有「與新訂閱 ID 不同」的舊活躍訂閱 (users.dodo_subscription_id)。若有，必須主動呼叫 Dodo API 將舊訂閱取消，確保用戶不會被雙重扣款，並將資料庫的 dodo_subscription_id 更新為最新訂閱。
   - 影響檔案：loamlab_backend/api/webhook.js, loamlab_backend/lib/activate.js

3. **[MUST] 強化 processTopup 金額驗證與點數疊加邏輯**
   - 描述：在 processTopup 發放點數前，**必須校驗實付金額** (amount_usd_cents)。若金額異常則拋出錯誤並記錄到 webhook_errors。同時，若是新訂閱取代舊訂閱，剩餘的點數應該「疊加」或「覆寫」，請設計一個不易出錯的點數發放邏輯。
   - 影響檔案：loamlab_backend/lib/activate.js

4. **[MUST] 移除前端的補差價提示與依賴**
   - 描述：前端介面如果出現「按比例退款」、「補差價」等字眼，需全面清除。文案應改為：「升級將立即以新方案重新計費並發放全額點數，舊方案將自動取消」。
   - 影響檔案：loamlab_plugin/ui/

5. **[MUST] 修復 SU 2022 開啟插件時「像拍照一樣卡住」的問題**
   - 描述：SU 2022 用戶反饋打開插件時會凍結（需重開多次才能連上）。這極可能是因為插件在對話框初始化 (ready callback) 時，同步觸發了 view.write_image 或鏡頭同步，導致主執行緒阻塞。
   - 解決方案：在 Ruby 端將初次的 view.write_image 或鏡頭捕捉操作，使用 UI.start_timer(0.5, false) 延遲執行，讓 HTML 先順利渲染完畢。
   - 影響檔案：loamlab_plugin/main.rb 或處理初始化連線的 Ruby 檔案。

6. **[MUST] 優化推薦碼 (Referral Code) 介面與複製功能** — [x] DONE 2026-07-23
   - 描述：
     - **UI 冗長**：「推薦碼 / 大使代碼 (REFERRAL / AMBASSADOR CODE)」字樣太長，請簡化。✅ 已移除 6 語言重複的英文括號後綴。
     - **期待落差**：用戶以為輸入推薦碼會「立刻」得到點數，但現行邏輯是「首次付費後」才發放。請在 UI 上將此規則做得更醒目，消除誤解。⏭️ 查核後 `referral_bound_msg2` 已用粗體+顏色標示「首次付費後」，判斷已足夠醒目，跳過。
     - **複製失效**：SU 2022 內建瀏覽器不支援 navigator.clipboard.writeText。✅ 改用純 JS `document.execCommand('copy')` 隱藏 textarea fallback（SketchUp Ruby API 無原生 `UI.set_clipboard`，原描述的 Ruby 方案不存在，改走已驗證可行的純前端相容寫法）。
   - 影響檔案：loamlab_plugin/ui/app.js, loamlab_plugin/ui/index.html, loamlab_plugin/ui/i18n.js

---

## 執行備註（Claude 評估後調整，2026-07-23）

- **T1-T4 已在近期 commit 完成，本次未再動**（`84aad27` 洗點事故重構、`beadb5c` 補金額驗證路徑）：
  - T1 change-plan 廢除 → `loamlab_backend/api/user.js:52-106` 已改全新 `/checkouts` 流程
  - T2 舊訂閱自動取消 → `loamlab_backend/lib/activate.js:cancelDodoSubscription()` + `webhook.js:123` 已串接
  - T3 processTopup 金額驗證 → `activate.js:60-68` `AMOUNT_TOLERANCE` 比對 Dodo 真實訂閱金額已上線
  - T4 前端補差價文案清除 → `app.js:4120` 註解確認已移除
- **T5 SU2022 開啟卡住** — [x] 已套用防禦性修復 2026-07-23。查無 log（用戶端回報、非可重現案例），確認無法進一步診斷根因後，改採低成本保險：`main.rb:268` `getInitialData` callback 整段包進 `UI.start_timer(0.3, false)`，讓 WebView 先完成畫面繪製再執行 Ruby 端 API 呼叫與 `execute_script`，避免搶主執行緒。**未確認是否解決真因**，需後續使用者回報驗證。
- **T6 已完成**，實作方式與原描述有 1 處落差：SketchUp Ruby API 沒有 `UI.set_clipboard` 這個方法，改用純前端 `execCommand('copy')` fallback 達成同等效果，未改動 Ruby 檔案。

status: DONE（全數 6 項完成，T5 為防禦性修復未確認根因，待使用者回報驗證）