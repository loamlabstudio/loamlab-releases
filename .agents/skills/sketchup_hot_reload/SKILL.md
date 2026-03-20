---
name: SketchUp Plugin Hot Reload
description: 解決 SketchUp 插件開發時的快取鎖死與熱重載更新失敗問題，確保開發修改能即時生效。
---

# SketchUp 插件開發與熱重載防呆指南
當你開發 SketchUp Plugin 時，常常會遇到修改了 Ruby 或 HTML/JS 檔案，但重新開啟 Extension 或點擊重載按鈕時卻「完全沒有反應」或「畫面依舊是舊版」的靈異現象。這篇指南總結了四大核心坑點與標準解法。

## 為什麼常規重啟/關閉視窗會失效？
1. **$LOAD_PATH 挾持**：SketchUp 的 `$LOAD_PATH` 預設會優先讀取位於 `%AppData%\SketchUp\SketchUp 2024\SketchUp\Plugins` 內的舊版靜態安裝檔，導致無底限載入舊代碼。
2. **CEF 快取鎖死**：SketchUp 內嵌的 CEF (Chromium Embedded Framework) 瀏覽器非常頑固，它會將 HTML 引用的本地 JS/CSS 強制快取。
3. **視窗自我毀滅鎖死 (Deadlock)**：如果你試圖在前端 JS 觸發的 Callback 中，呼叫 Ruby 的 `@dialog.close` 並試圖重啟該視窗，SketchUp 底層為了保護執行緒安全，會直接吞掉該異常，導致「點擊沒反應」。

## 必備防呆標準寫法 (四把金鑰)

### 金鑰 1：從入口檔搶奪 $LOAD_PATH 優先權
在你的開發環境根目錄載入檔 (譬如 `loamlab_plugin.rb`) 頂端，強制推入開發路徑。
```ruby
# 將當前外掛開發目錄推入 $LOAD_PATH 的最前面
dev_dir = File.dirname(__FILE__)
$LOAD_PATH.unshift(dev_dir) unless $LOAD_PATH.include?(dev_dir)

unless file_loaded?(__FILE__)
  # 註冊 Extension...
```

### 金鑰 2：HTML Cache-Busting (打破前端快取)
在 `main.rb` 載入 HtmlDialog 時，掛載動態時間戳。
```ruby
current_dir = File.dirname(__FILE__)
html_path = File.join(current_dir, 'ui', 'index.html')
# 使用 set_url 而非 set_file，以便串接 Query String 打破快取
url = "file:///#{html_path}?t=#{Time.now.to_i}"
@dialog.set_url(url)
```

在前端的 `index.html` 引入 JS/CSS 時，手動加上版號參數：
```html
<script src="./app.js?v=3"></script>
<script src="./i18n.js?v=3"></script>
```

### 金鑰 3：安全的 Ruby 動態熱重載 (Live Reload)
千萬不要在 Callback 中關閉對話框，改用 `load __FILE__` 覆寫原本記憶體中的方法，並丟出前端 `reload()` 指令：
```ruby
dialog.add_action_callback("check_update") do |action_context, params|
  # 1. 重新解析 Ruby 檔案，覆蓋所有 Model/Class 方法
  begin
    load __FILE__ 
  rescue => e
    UI.messagebox("Ruby 載入錯誤: #{e.message}")
  end
  
  # 2. 透過原生 JS 重整綁定的瀏覽器畫面 (這對 CEF 是 100% 安全的)
  dialog.execute_script("window.location.reload();")
end
```

### 金鑰 4：強效底層錯誤雷達
不要依賴 `puts`，因為很多時候你不會開 Ruby Console。將可能出錯的方法全部包裝彈出式警告：
```ruby
begin
  # 易出錯邏輯
rescue => e
  # 原生報警，不破壞執行緒
  UI.messagebox("錯誤發生: #{e.message}") 
end
```

## 日後如何召喚這個 Skill？
日後，當你在開發任何新的 SketchUp 插件遇到畫面沒有連動更新、或是重構完出現卡死狀態時，請對我說：
> **「請參考 SketchUp Plugin Hot Reload 這項 Skill，幫我檢查我的新插件是不是又踩到快取或死鎖的坑了。」**
我就會從這四大面向對你的代碼進行掃描，自動植入時間戳與脫鉤重載代碼。
