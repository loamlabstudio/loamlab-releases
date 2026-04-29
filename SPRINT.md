# Sprint: 精簡 Smart Canvas 遮罩提示詞映射結構

## CONTEXT_DIGEST
為了避免冗長的 Prompt 分散 AI 模型注意力，並加速解析，需將後端 `render.js` 傳遞的 `{{CHANGES}}` 鍵值對結構進一步極致精簡。我們將採用最短、最明確的箭頭映射語法（如 `Color #HEX -> Target`），去除不必要的形容詞。

## TASKS

1. **[x] 精簡後端色碼映射格式**
   - **影響檔案**：`loamlab_backend/api/render.js`
   - **說明**：定位 `activeTool === 2` 的 prompt 字串切分邏輯。將其修改為最精簡的映射格式：
     ```javascript
     if (spl[0] && spl[1]) {
         changes.push(`Color ${spl[0].trim()} -> ${spl[1].trim()}`);
     }
     ```
     這會讓 `{{CHANGES}}` 變成最乾淨的 `Color #ff6432 -> 女鬼`，大幅降低視覺大模型的理解負擔。

status: DONE
