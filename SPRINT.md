# Sprint Plan: KOL/合夥人系統 Bug 修復

**Context Digest:**
- 合夥人系統 (Partner) 核心分潤已實作，但在結帳折扣與晚期歸因上存在遺漏。
- `user.js` 結帳時未讀取 `is_partner` 導致合夥人專屬折扣碼無法自動套用。
- `webhook.js` 晚期綁定寫死 `is_kol=true` 導致合夥人折扣碼訂單無法成功歸因。

## TASKS

- **[MUST] Task 1: 修復結帳自動折扣判斷** ✅
  - **影響檔案**: `loamlab_backend/api/user.js`
  - **描述**: 在 `action=checkout` 邏輯中，將 `select` 查詢加上 `is_partner`。並將後續判斷修改為 `if ((kol.is_kol || kol.is_partner) && kol.dodo_discount_code)`，確保合夥人折扣碼在結帳時生效。

- **[MUST] Task 2: 修復 Webhook 晚期歸因邏輯** ✅
  - **影響檔案**: `loamlab_backend/api/webhook.js`
  - **描述**: 在 `processTopup` 中的晚期綁定邏輯（late-bind），將查詢條件從 `.eq('is_kol', true)` 改為 `.or('is_kol.eq.true,is_partner.eq.true')`，確保手動輸入合夥人折扣碼的買家能被正確歸因。

status: DONE
