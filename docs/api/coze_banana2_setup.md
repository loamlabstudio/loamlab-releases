# LoamLab: Coze Workflow (Banana 2) 部署教學指南

這份指南將手把手教您如何在 Coze 上建立一個專屬的 **「圖片處理工作流 (Workflow)」**，讓它能接收 SketchUp 傳來的空間草圖，並套用提示詞交給模型 (如 Banana 2 等底層生圖模型) 進行渲染，最後再吐回結果。

## 階段 1：建立專屬工作流 (Workflow)

1. **登入 Coze 工作台**
   - 前往 [Coze 國際版官網 (coze.com)](https://coze.com/) 並登入您的帳號。
   - 點擊左側導覽列的 **"Workflows" (工作流)**。
   - 點右上角的 **"Create workflow" (建立工作流)**。

2. **基本設定**
   - **Name (名稱)**: `SketchUp_Banana2_Renderer`
   - **Description (描述)**: `接收 SketchUp 原圖與提示詞，調用模型渲染出室內空間效果。`
   - 點擊 **"Confirm" (確認)**，進入畫布編輯模式。

---

## 階段 2：設定「資料入口」節點 (Start Node)

這是用來接住 SketchUp 丟過來的資料的。
1. 在畫面最左側找到預設的 **"Start" (開始)** 節點。
2. 點擊 "Start" 節點右上角的 **"+"** 號，新增兩個輸入參數 (Parameters)：
   - 參數 1：
     - **Name**: `scene_name`
     - **Type**: `String`
     - **Description**: 場景名稱 (可選)
   - 參數 2：
     - **Name**: `base64_image`
     - **Type**: `String`
     - **Description**: SketchUp 傳來的 Base64 圖片字串
   - 參數 3：
     - **Name**: `base_prompt`
     - **Type**: `String`
     - **Description**: 基礎提示詞 (由 SketchUp 或大腦提供)

---

## 階段 3：建立「程式碼」節點 (Code Node) - 提示詞編排

我們需要一個節點，將收到的 base_prompt 與其他的關鍵字（例如 Banana 2 專屬的咒語後綴）結合在一起。這是最適合您日後「自由編輯與更新」的地方。

1. 從左側面板 (Nodes) 拖曳一個 **"Code" (代碼)** 節點到畫布中間。
2. 將 "Start" 節點右邊的圓點，連接到 "Code" 節點左邊的圓點。
3. 點擊 "Code" 節點進行設定：
   - 點擊 **"Edit Code" (編輯代碼)**。

### 插入您的編排代碼 (Python)
將原本的範例清空，直接複製貼上以下 Python 程式碼：

```python
async def main(args):
    # 1. 取得從上一層傳來的參數
    base_prompt = args.input.get("base_prompt", "")
    scene_name = args.input.get("scene_name", "")
    raw_base64 = args.input.get("base64_image", "")
    
    # 2. 💡【在此處加上您的黃金 prompt 後綴/前綴】💡
    # ==========================================
    # 您未來可以隨時回來這裡修改，加上例如 "8k", "unreal engine 5" 等字眼
    enhanced_prompt = f"{base_prompt}, high quality interior design, stunning architectural photography, realistic lighting, 8k resolution, highly detailed."
    # ==========================================
    
    # 3. 處理圖片 (某些生圖節點要求 Data URI 格式，若有則加回，沒有則原樣輸出)
    # 若 API 需要 `data:image/jpeg;base64,` 標頭
    formatted_base64 = raw_base64
    if not formatted_base64.startswith("data:image"):
         formatted_base64 = "data:image/jpeg;base64," + formatted_base64

    # 4. 輸出給下一個節點
    return {
        "final_prompt": enhanced_prompt,
        "processed_image": formatted_base64
    }
```

### 設定 Code 節點的輸入與輸出
在 Code 節點的參數列中：
- **Input Parameters (輸入)**:
  - 點擊 `+` 號對齊剛剛代碼裡寫的變數：
    - 變數 `base_prompt` -> 連接 Start 節點的 `base_prompt`
    - 變數 `scene_name` -> 連接 Start 節點的 `scene_name`
    - 變數 `base64_image` -> 連接 Start 節點的 `base64_image`
- **Output Parameters (輸出)**:
  - 新增 `final_prompt` (Type: `String`)
  - 新增 `processed_image` (Type: `String`)

點擊 **"Test code"** 且確定沒報錯後，點 **"Save" (儲存)**。

---

## 階段 4：建立「Banana 2 / 繪圖模型」節點 (Plugin Node)

接下來，我們要把整理好的提示詞與圖片交給真正的繪圖模型。

1. 從左側面板的 **"Plugins"** 頁籤中，搜尋您想要使用的底層模型。
   - *註：如果您使用的是 Coze 內建的 Plugins，請搜尋類似 "Stable Diffusion", "Midjourney", "DALL-E 3" 或是您有串接 Banana 2 API 的自定義 Plugin。*
2. 將找到的 **Plugin 繪圖行為 (Action)** 拖放到畫布上。
3. 將剛剛 `Code` 節點的輸出點，連到這個 `Plugin` 節點的輸入點。
4. 設定 Plugin 的參數：
   - 找到模型的 **"prompt" (提示詞)** 欄位 -> 點擊變數選擇器 -> 選擇引用 `Code.final_prompt`。
   - 找到模型的 **"image / reference image / controlnet image" (參考圖)** 欄位 -> 點擊變數選擇器 -> 選擇引用 `Code.processed_image`。

---

## 階段 5：設定「最終輸出入口」 (End Node)

1. 將 `Plugin` 節點的輸出，連接到最右側的 **"End" (結束)** 節點。
2. 點擊 "End" 節點，新增一個輸出參數：
   - **Name**: `render_result_url`
   - **Type**: `String`
   - **Value**: 指向 `Plugin` 節點回傳的圖片網址 (通常是 `Plugin.image_url` 之類的欄位)。

---

## 階段 6：發布與獲取 ID (部署)

1. 點擊右上角的 **"Test run" (測試運行)**，隨機輸入幾個假的字串測試工作流能順利跑到 End 節點。
2. 測試沒問題後，點擊右上角的藍色按鈕 **"Publish" (發布)**。
3. **【關鍵】抄下您的 Workflow ID**
   - 發布後，在 URL 網址列中尋找類似：
     `https://www.coze.com/space/12345/workflow/7350021980000000000`
   - **`7350021980000000000`** 這串數字就是您的 **Workflow ID**。請把它記下來！

---

## 階段 7：回到 SketchUp 串接

當您有了專屬的 工作流 ID，就可以將其寫入我們的 SketchUp 外掛中了。
在剛剛做好的 `coze_api.rb` 中，我們會將原本呼叫大腦 (`chat`) 的寫法，改成「直接呼叫 Workflow API」。

這會讓您的架構變成：
**SketchUp 核心介面** ➔ (傳送圖片與基礎設定) ➔ **Coze Workflow 的 Start 節點** ➔ (Python 工作流組合強效 Prompt) ➔ **生圖模型渲染** ➔ (回傳圖片網址) ➔ **展示於 SketchUp UI 中**。

如果您確認已在 Coze 端建立好這個工作流拿到 ID，請告訴我，我會幫您把 `coze_api.rb` 的呼叫方式升級為工作流專用的 `workflow/run` API 端點！
