# SPRINT: 修復批量渲染閃退與 KOL 貨幣顯示

## CONTEXT_DIGEST
用戶回報兩個問題：1) 批量渲染時，SketchUp 插件面板會失去焦點（閃退到背景），需要重新點擊才能喚回。這肇因於切換場景時 SketchUp 主視窗會強行搶奪焦點。2) KOL 大使儀表板的提領金額目前只處理了 TW/CN/US，切換到日文、西文等語系時沒有對應定價牆的貨幣（日圓、歐元、黑奧）。

## TASKS

- [x] **[MUST] TASK 1: 修復批量渲染導致的 UI 面板失焦 (閃退) 問題**
  - **影響檔案**: `loamlab_plugin/main.rb`
  - **細節**: 在 `batch_export_scenes` 迴圈中，當切換場景 (`Sketchup.active_model.pages.selected_page = page`) 或執行 `view.write_image` 之後，主視窗會搶走焦點。請在這些操作後（例如每次迴圈的末尾或觸發 export_done 之前），加入 `dialog.bring_to_front` 來強制把插件視窗拉回最上層，確保用戶視覺不中斷。

- [x] **[MUST] TASK 2: 統一 KOL 大使提領金額的多幣種顯示**
  - **影響檔案**: `loamlab_plugin/ui/app.js`
  - **細節**: 找到 `fetchKolDashboard` 函數內的貨幣換算邏輯（約在第 2692 行）。
  - **修改目標**: 補齊剩餘語系的貨幣轉換，對齊定價牆匯率（基準為 USD）。
    - 增加 `es-ES` (歐元)：`display = \`€ \${(usd * 0.92).toFixed(1)}\`;`
    - 增加 `pt-BR` (巴西黑奧)：`display = \`R$ \${(usd * 5.0).toFixed(1)}\`;`
    - 增加 `ja-JP` (日圓)：`display = \`¥ \${Math.round(usd * 150)}\`;`

status: DONE
