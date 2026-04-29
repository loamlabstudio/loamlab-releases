# Sprint: 結構化 Smart Canvas 提示詞與色塊映射

## CONTEXT_DIGEST
為了讓 Atlas 的多模態模型能精準映射「多區域修改」，同時避免使用生硬符號（如 `[]`）導致解析崩潰，我們需要將後端 `render.js` 中處理 prompt 的邏輯重構。將原本的色碼與文字，轉化為結構化且語意明確的鍵值對（如 `Zone Color: #HEX, Target Object: XXX`），讓 AI 能嚴格對應色塊與物件。

## TASKS

1. **[x] 重構後端色碼映射格式**
   - **影響檔案**：`loamlab_backend/api/render.js`
   - **說明**：定位 `activeTool === 2` 的 prompt 字串切分邏輯。將字串組合的方式改為高可讀性的結構化輸出：
     ```javascript
     if (spl[0] && spl[1]) {
         changes.push(`- Zone Color (HEX): ${spl[0].trim()}\n  Target Object: ${spl[1].trim()}`);
     }
     ```
     這會讓送給 AI 的 `{{CHANGES}}` 變數變成非常清晰的條列式結構，徹底消除結構模糊的問題，並確保色碼 100% 存活。

status: DONE
