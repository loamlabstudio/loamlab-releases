<!-- ============================================================
     ⛔ 本檔為唯讀結論檔，僅由 Claude Code 與用戶維護。
     Gemini / Antigravity：禁止寫入、整理、重排、修改 status。
     你的提案請寫入 SPRINT_PROPOSAL.md。詳見 GEMINI.md「職責邊界」。
     ============================================================ -->

# LoamLab V2.6 架構與商業化優化 Sprint（v2 — 事實校正版）

> 本版取代 Gemini 於 2026-09-07 產出的初版。初版四項任務中，**一項的風險描述無事實根據、一項的技術前提錯誤、一項在現行架構下不可行**。
> 以下每一條結論都附可複驗的證據（檔案:行號 / 指令）。

---

## CONTEXT_DIGEST

初版的核心判斷是「巨石架構 + Vercel 4.5MB 是最大隱患」。實際查證後，這兩項都不是當前最高風險：

- **4.5MB 對 T1 已有完整防護**（`loamlab_plugin/main.rb:2011-2030` 三層降級）。真正沒防護的是 T2 / SmartCanvas，而初版連 `app.js` 都沒列進影響檔案。
- **真正在流血的是出貨與治理層**：出貨包 98% 是教學圖、`_wip` 安全機制根本不存在、repo 已被二進位檔養到 383MB。

這三項的共同點是：**成本低、風險低、但每一次 release 都在複利地扣分**，且完全不在初版的視野內。

---

## TASKS

### `[x] [P0]` T0：補上 `_wip` 硬排除 — 文件宣稱的安全機制實際不存在（**2026-09-07 已修復**）

> **已完成**：`build_rbz.ps1:44`（direct）與 `:48`（EW）兩份 `$excludePatterns` 都已加入 `'_wip'`，
> 文件宣稱與實際行為現在一致。

- **影響檔案**：`build_rbz.ps1`
- **證據**：
  - `CLAUDE.md` 明文寫著：「`build_rbz.ps1` 對含 `_wip` 的路徑結構性硬排除（direct/EW 皆排除，`-Force` 也無法繞過）」
  - 實測 `grep -c "_wip" build_rbz.ps1` → **0**。排除清單（`build_rbz.ps1:44,48`）只有 `node_modules, test_, package-lock.json, package.json, .testsprite, test_screenshot, updater.rb`
  - 現行 `loamlab_plugin.rbz` 內確實含有 `loamlab_plugin/_wip/README.md`（解壓縮驗證）
- **風險**：團隊被文件告知可以信任 `_wip/` 存放未完成代碼，實際上會**靜默出貨給付費用戶**，無任何警告。這是整份稽核中唯一「已寫進規範、但保護為零」的項目。
- **修法**：在兩份 `$excludePatterns` 加入 `'_wip'`。
- **成本**：1 行。**優先於本 Sprint 所有其他任務。**

### `[x] [P0]` T1：回滾被誤刪的中文品牌名（**2026-09-07 已修復**）

> **已完成**：名稱已改回 `'LoamLab Camera (野人相機)'`，UTF-8 無 BOM 驗證通過。
> 補充查證：v1.4.74 出貨中的 `.rbz` 與四月部署到 SketchUp 的副本，各自帶**不同**的亂碼變體
> （`闂佹彃绨煎Ч澶愭儎閸涘鐔?` 與 `閲庝汉鐩告`）。這代表亂碼不是單次意外，而是工具鏈反覆
> 以錯誤編碼重新寫入造成的累積損壞。**下次若再出現亂碼，要查的是寫入端，不是檔案本身。**
> 名稱變更需 SketchUp 重啟才會反映（擴充註冊發生在啟動時，熱重載無法更新此項）。

- **影響檔案**：`loamlab_plugin.rb`
- **初版宣稱**：「亂碼註解在不同語系的 Windows 極易導致 SketchUp 載入外掛失敗」→ **無事實根據**
  - 實測舊檔通過 .NET `UTF8Encoding(false, true)` 嚴格解碼（PASS），是**合法 UTF-8**，只是內容為亂碼
  - Ruby 2.0+ 預設源碼編碼即 UTF-8，且會自動跳過 UTF-8 BOM。合法 UTF-8 的**註解**不會使載入失敗
- **真正的問題**：亂碼落在 `SketchupExtension.new()` 的**顯示名稱**字串，用戶在 Extension Manager 直接看得到。這是品牌瑕疵，不是崩潰風險。
- **初版的副作用**：把品牌名整個刪除
  - 原值 `'LoamLab Camera (野人相機)'`（由 `tmp/unzipped_rbz_new/loamlab_plugin.rb:14` 與 `tmp/check_config/loamlab_plugin.rb:14` 復原）
  - 現值 `'LoamLab Camera'` — 中文品牌識別消失
  - 而 `ui/locales/zh-TW.json` / `zh-CN.json` 的產品標題是「野人相機 (LoamLab Camera)」，中文市場是主要客群，Extension Manager 與產品內名稱就此不一致
  - 附帶：`Sketchup.register_extension` 的名稱同時是 Extension Manager 的顯示與識別依據，改名有讓既有用戶啟用狀態被當成新擴充的風險
- **修法**：名稱改回 `'LoamLab Camera (野人相機)'`。**保留**初版的 BOM 移除與縮排修正，那兩項是淨改善。
- **驗收**：Extension Manager 顯示「LoamLab Camera (野人相機)」，且既有用戶升級後啟用狀態不變。

### `[x] [P1]` T2：出貨包瘦身 13.63MB → **2.42MB**（**2026-09-07 已完成，做法與原案不同**）

> **改用零風險做法，不需要遠端託管、不需要部署。** 原案要把教學圖搬到後端遠端載入，
> 代價是離線用戶看不到教學圖、且必須部署。查證後發現有兩個更省事的來源：
>
> | 項目 | 處置 | 省下 |
> |---|---|---|
> | `hero-bg.jpg`（8.44MB，6014×4506）| **孤兒副本，打包排除** | 8.44 MB |
> | 其餘 5 張教學圖 | 重新壓縮至 q80，**尺寸不變** | 4.02 MB |
> | `before.jpg` | q80 反而變大（126%），**已還原原檔** | — |
>
> **`hero-bg.jpg` 是孤兒的證據**：全專案唯一引用它的是 `loamlab_backend/public/index.html`，
> 走的是後端自己的 `/images/hero-bg.jpg`（該檔存在且未動）。插件的 `TUTORIAL_CONFIG` 完全沒引用它，
> 卻讓每位用戶每次更新白下載 8.4MB。
>
> **驗證**：打包邏輯乾跑 33 個檔案共 2.42MB；`_wip` 外洩 0、`hero-bg` 外洩 0；
> 5 張重壓圖的寬高全部與原檔一致且可正常解碼。原檔已備份至
> `C:\Users\qingwen\loamlab_backup_20260907\tutorial_images_original\`（13.3MB，可隨時還原）。
>
> **未做**：`tutorial_images/` 仍未進版控（乾淨 clone 無法重現出貨包）。現在只剩 1MB，
> 納入版控已可行，但那牽涉「二進位檔進 git」與 `.git` 已 383MB 的問題，留待一併決定。

<details><summary>原始分析（保留備查）</summary>

- **影響檔案**：`loamlab_plugin/ui/assets/tutorial_images/`、`loamlab_plugin/ui/tutorial.js`、`build_rbz.ps1`、`.gitignore`
- **證據**：
  | 項目 | 體積 | 佔比 |
  |---|---|---|
  | `loamlab_plugin/ui/assets`（教學圖 10 檔） | 13.3 MB | **98%** |
  | 其餘全部代碼 | ~0.3 MB | 2% |
  | `.rbz` 總計 | 13.6 MB | |
- **風險**：
  1. 目標客群是獨立設計師與學生（見 `.agents/product-marketing-context.md`），13.6MB 下載是實質安裝摩擦
  2. 產品有自動更新機制 → **每個 patch 版都讓全體用戶重下 13.6MB**，其中 98% 是完全沒變的圖片
  3. `tutorial_images/` 在 git 是未追蹤（`??`）狀態 → **乾淨 clone 無法重現此出貨包**，破壞建置可重現性
- **修法**：教學圖改由後端託管（`loamlab_backend/public/`）並於 `tutorial.js` 遠端載入，`build_rbz.ps1` 排除該目錄。
- **附帶收益**：修好後 `.rbz` 應移出版控 — 目前它被 git 追蹤，每次 build 產生新的 ~14MB blob，`.git` 已達 **383MB**。
- **本 Sprint 唯一同時改善安裝轉換率與頻寬成本的項目。**

</details>

### `[x] [P1]` T3：為 T2 / SmartCanvas 補上 payload guard（**2026-09-07 已完成**）

> **已完成**（只改 `app.js`，不動 `render.js`、不碰金流）：
> - `app.js:5338` 新增 `_scShrinkDataUrl`，先降 quality 再縮邊長，邊長先夾到 `SC_DOC_MAX_EDGE`(1920)
>   避免用戶上傳的大圖撞破弱 GPU 的 canvas backing store 上限
> - 三處套上預算：composite 1.2MB、original 1.2MB、參考圖總計 1.4MB
> - **參考圖張數一張都不減**。`prompt` 裡的「see image N」與 `_scAssignRefImageIndices()` 共用同一份索引，
>   少一張整組錯位、AI 會抓錯圖。所以只壓內容，預算按張數均分
> - `app.js:6662` 補 `resp.ok` 檢查。413 是 Vercel 在函式執行「之前」擋下的（未扣點），
>   body 不是 JSON，直接 `resp.json()` 會拋錯落進 catch，用戶只看到「網路錯誤」而重複送出。
>   改為明確訊息「圖片資料過大，請減少參考圖張數」，並以 `_userFacing` 旗標避免 catch 再加前綴
>
> **驗證**：`node --check` PASS；`npm run lint`（ESLint ecmaVersion 2019）零錯誤；
> 最壞情況 payload 試算 3.62MB，低於 Ruby 端 4.0MB 安全線與 Vercel 4.5MB 硬上限。
>
> **真正的破口是參考圖**：它們是 `FileReader` 直接讀進來的用戶原檔（`app.js:5197` 等），
> 完全未壓縮、張數無上限。一張手機照片就可能 5MB，兩張必爆。

<details><summary>原始分析（保留備查）</summary>

- **影響檔案**：`loamlab_plugin/ui/app.js`（初版遺漏此檔）
- **初版宣稱**：「Vercel 4.5MB 會直接導致 4K 高畫質渲染崩潰，引發退款」→ **前提錯誤**
  - 4K 指的是**輸出**解析度；**輸入**截圖早已被限制
  - `main.rb:2011-2030` 已有三層防護，註解明寫「Payload guard: 超過 Vercel 4.5MB 限制時按比例精準壓縮，用戶無感知」：超過 4.2MB → 反推 quality 重截 → 仍超 → 降解析度到 1152×768
  - `main.rb:1627` 的 `write_image_capped` 另有 1.2MB 單圖上限
  - 結論：**T1 的 1K/2K/4K 都不會因 payload 崩潰**，初版描述的退款情境在 T1 不存在
- **初版方案的另一個問題**：提議改用 Supabase Storage 簽名 URL，但 `render.js:733-737` 的註解記載**這條路已經走過並被移除** —— 後端上傳後又下載回來轉 base64，多一次上傳加一次下載（約 1~2 秒 + 雙倍頻寬），AtlasCloud 最終收到的還是同一份 base64
  - 公允說明：初版提的是**插件端直傳**（繞過 Vercel ingress），與被移除的「後端上傳」不同，理論上確實能解 ingress 限制。但既然 T1 已無此問題，為它重寫 `render.js` 的圖片入口 = **動到扣點瀑布與退款邏輯所在的金流路徑，換取零用戶可見收益**
- **真正的破口在 T2**（`app.js:6543-6564`）：
  - `original_image_b64`：canvas `toDataURL('image/jpeg', 0.9)`，**無尺寸與體積上限**
  - `base_image`：composite canvas，**無上限**
  - `ref_images[]`：**張數無上限、單張無上限**
  - 三者相加送同一個 JSON body，**完全沒有任何 payload guard**
  - 附帶缺陷：`app.js:6597` 未檢查 `resp.ok`，413 會使 `resp.json()` 拋錯並落入 catch，用戶看到「網路錯誤」而非「圖片太大」，歸因誤導
- **修法**：把 T1 已驗證的 capped 策略移植到 T2（canvas 匯出前依總量反推 quality／限制 `ref_images` 張數），並補 `resp.ok` 檢查與正確錯誤文案。
- **成本**：數十行，**不動 `render.js`、不碰金流**。

</details>

### `[P2]` T4：`app.js` 拆檔 — 但**禁止使用 ESM**（取代初版 Task 3）

- **影響檔案**：`loamlab_plugin/ui/app.js`、`loamlab_plugin/ui/index.html`
- **初版宣稱**：「抽離為獨立的 JS 模組（ESM）」→ **在此架構下不可行**
  - `main.rb:250` 以 `set_url("file://...")` 載入 UI（`path_to_file_uri(html_path)`）
  - Chromium 對 `file://` 來源一律視為 opaque origin，`<script type="module">` 的每次 module fetch 都會被 CORS 阻擋而失敗
  - 這**不是舊 CEF 的限制**，現行 Chrome 同樣如此 → 會是實作到一半才撞上的死路
- **連帶風險**：初版的依賴鏈是 `Task 2 → Task 3 → Task 4`。第一環前提錯誤、第二環不可行，**整條下游連坐**。本版已解除三項的相互依賴，各自獨立可交付。
- **實際尺寸校正**：`app.js` 為 **345KB**（初版稱 353KB）、`main.rb` **110KB**（初版稱 112KB）。量級判斷成立，數字略有出入。
- **可行修法（擇一）**：
  1. 維持 classic script，以 IIFE + 單一全域命名空間拆檔（`index.html:1725-1730` 的 `document.write` 已在做同步插入，順序語意與原本一致）
  2. 導入 esbuild 打包步驟，開發期分模組、出貨時仍輸出單一 classic script
- **建議**：先做方案 1 抽出 Sidebar 與 Render Controller 兩塊即可，不引入建置鏈。

### `[P3]` T5：渲染等待微互動（維持初版 Task 4，但需附量測）

- **影響檔案**：`loamlab_plugin/ui/app.js`、`loamlab_plugin/ui/index.html`
- **初版宣稱**：「直接影響訂閱留存率」→ **目前無任何量測設計可驗證此因果**
- 定價為 Starter $24 / Pro $52 / Studio $139（`POINTS_SYSTEM.md`），留存確實有可觀價值，但骨架屏對留存的因果目前是零證據。
- **前置條件**：先具備「首次渲染完成率」與「次月續訂率」兩個基線數字，否則做完也無法判斷是否有效。
- **在基線建立前，此項維持 `[NICE]`，不佔用 P0/P1 產能。**

### `[x] [P0]` T6：渲染圖一定要落地存檔（**2026-09-07 已實作，待實機驗收**）

> **已完成**（僅改 `main.rb`，`app.js` 未動，原因見下方「與提案的第三點分歧」）：
> - 新增 `main.rb:1080` `download_and_save_render`，Ruby 直接下載，不經 JS 往返
> - 掛在 `handle_render_response` 內的 `deliver` 包裝（`main.rb:1149`），4 條回報路徑
>   （`1177`／`1182`／`1192`／`1194`）全部經過，一次涵蓋 6 個呼叫點
> - 去重用 **url**（非檔名）＋ `@@saving_urls` in-flight 表，擋住「Ruby 與 JS 幾乎同時觸發」的競態
> - 非 200 改為退避重試 2s／4s／8s，取代原本 `next unless status == 200` 的靜默放棄
> - `auto_save_render` callback 改為委派同一份實作，不再有第二套邏輯
>
> **驗證**：以 HEAD 已知可運行版本為基準做區塊平衡比對，結構差值 0；新方法單獨檢查深度 0；
> `main.rb` 嚴格 UTF-8 通過。**本機無 Ruby 直譯器，無法跑 `ruby -c`**，語法最終仍需熱重載實測。

**與提案的第三點分歧（提案建議刪掉 `app.js` 兩處呼叫，實際只能刪一處，故兩處都保留）**

查證發現 **SmartCanvas (T2) 根本不經過 Ruby**：前端在 `app.js:6583` 直接 `fetch` 打 `/api/render`，
而 Ruby 的 `smart_canvas_execute` callback（`main.rb:851`）前端從未呼叫，是**死碼**。
因此 `app.js:6617` 是 T2 唯一的存檔路徑，刪掉會讓 T2 完全不存檔。既然必須留一處、就必須保留去重，
留兩處的邊際成本為零，故 `app.js` 完全不動（風險最低）。

- **殘留缺口**：T2 SmartCanvas 的輪詢在 JS 端，面板關閉後仍會掉圖。要補需把 T2 改走 Ruby，
  屬獨立工作項，不在本次範圍。T1／T3／批量已完全覆蓋。
- **實機驗收**：渲染送出後立刻關閉插件面板，圖仍出現在存檔資料夾；同一次渲染只產生一個檔案。

- **影響檔案**：`loamlab_plugin/main.rb`（`app.js` 經查證後判定不動）
- **問題**：渲染成功、點數已扣，但圖沒存到用戶資料夾。原因是存檔全靠 JS 繞一圈——
  Ruby 收到結果 → 丟給前端 → 前端再回頭呼叫 `auto_save_render`。用戶如果在等待期間
  把面板關掉，`main.rb:97-99` 的輪詢器條件是 `unless @@pending_results.empty? || d.nil?`，
  dialog 一沒了結果就永遠卡在佇列裡，圖再也不會下載。
- **方向**：存檔改由 Ruby 背景直接做。`@@requests` 和 `UI.start_timer` 都不依賴 dialog，
  面板關了照樣能跑完。這點提案講對了。

**提案原方案要修正的三件事：**

1. **掛的位置要換。** 提案只改批量出圖那一段（`main.rb:2055-2057`），但
   `handle_render_response` 全專案有 6 個呼叫點（`882`、`1756`、`1791`、`1817`、`1850`、`2055`），
   單張渲染和 SmartCanvas 都不在裡面，一樣會掉圖。真正的匯流點是
   `main.rb:1117` 的 `on_result.call(final_result.merge(extra))`——所有非同步路徑都經過這行，
   存檔掛這裡一次蓋到全部。
2. **不能用「檔名存在」判斷有沒有存過，會失效。** 檔名是
   `時間戳_專案_場景_render.jpg`，但只有批量路徑的 `extra` 帶了 `timestamp`，
   其他 5 個呼叫點只有 `scene_name`。Ruby 和 JS 各自抓 `Time.now`，差幾秒就是兩個不同檔名，
   防重等於沒防到，反而會存兩份。**改用 `url` 或 `transaction_id` 當去重鍵**，
   而且 `cloud_index` 本來就在存 path→url 對應，現成可用。
3. **下載失敗會靜默丟掉。** `main.rb:718` 是 `next unless res.status_code == 200`，
   非 200 直接放棄。目標既然是「一定收到圖」，就得補退避重試。

**建議再簡化一步：** 與其「Ruby 存 + JS 存 + 防重」維護三套邏輯，不如讓 Ruby 當唯一存檔者，
直接刪掉 `app.js:1726` 和 `app.js:6617` 兩處呼叫，`auto_save_render` callback 保留供舊流程相容。
少一套防重要顧。

- **驗收**：渲染送出後立刻關閉插件面板，圖仍會出現在存檔資料夾；同一次渲染只產生一個檔案。

### `[x] [P0]` T7：批量渲染掉圖 — 檔名碰撞（**用戶回報，2026-09-08 已修**）

> **用戶回報**：批量渲染多張時收不到圖，單張渲染正常。

**T6 沒有涵蓋這個問題。** T6 解的是「關面板後結果卡在 `@@pending_results`」，
雖然也讓批量走 Ruby 存檔，但**不處理檔名碰撞**——兩次下載仍寫到同一路徑。

**根因：截斷破壞了唯一性的來源。** 場景名在同一模型內是唯一的，它就是檔名唯一性的唯一來源。
舊寫法 `scene[0, 30]` 砍掉尾巴，等於自己製造碰撞：

| | 批量 | 單張 |
|---|---|---|
| timestamp | 迴圈**外**只取一次，整批共用 | 呼叫端不帶，各自抓 `Time.now` |
| 唯一性靠 | 只剩場景名，而它被截斷 | 時間戳天然不撞 |
| 結果 | 前 30 字相同 → 同一路徑 → `File.binwrite` 靜默覆蓋 | 正常 |

這就是「批量掉圖、單張正常」的完整解釋。**實測 4 張同前綴場景只產生 2 個檔名，掉 2 張，點數照扣。**

附帶發現：`_original.jpg` 用的是**完整**場景名，所以截斷同時也破壞了
timestamp 一路帶下來想達成的「前後圖檔名相鄰」——截斷沒有達成任何目的。

**修法（從源頭解，非補釘子）**
1. `build_save_path`：不做固定截斷，只在路徑真的會破 240 字時縮最小必要量
2. `resolve_collision_free_path`：保留為最後防線（處理重算、路徑超長等剩餘情況）
   ＋ `@@reserved_paths` 佔位，因為批量是並行下載，光看 `File.exist?` 兩邊都會選到同名

**同時移除的多餘環節**
- **前端重複觸發**：`app.js` 的 `render_success` 又呼叫一次 `auto_save_render`，
  但 Ruby 在送給前端之前就已存好。同一張圖存兩次，且面板一關就斷。已移除，
  現在每條路徑只有一個觸發點。SmartCanvas 例外保留（前端直連 API，不經 Ruby）。
- **死碼 `smart_canvas_execute`**：Ruby 端 42 行，前端 0 次呼叫。已刪。

**存檔鏈現況**（唯一寫檔實作 `download_and_save_render`）
```
T1 單張／批量、T3、T2 家具替換 → handle_render_response → Ruby 存檔
T2 SmartCanvas 標註            → 前端直連 API → auto_save_render 回呼
T4 360 分享                    → 分享連結非圖片，前端提早 return，不觸發
```

**驗證**：`ruby -c` OK／`node --check` PASS／ESLint 零錯誤／命名測試證明舊碰撞新不碰撞／
碰撞防護三情境全 PASS／Release Gate 四項全過／`main.rb` 2421 → 2382 行。
**待實機**：批量多場景（場景名 >30 字且前綴相同）確認張數與算圖數一致。

### `[x] [P0]` T8：渲染前後圖比例不一致（**用戶回報，2026-09-08 已修並上線**）

> **用戶回報**：工具 1 無參考圖，但渲染前後兩張圖比例不同；AtlasCloud 後台可見
> 同樣是 T1，請求比例卻不一樣。

**根因：比例被四個地方各自宣告，沒有一個看圖。**

| 宣告點 | 內容 |
|---|---|
| `main.rb` 截圖目標 | 寫死 `closest_ratio = "3:2"` |
| `main.rb` 底圖模式 | 寫死 `"16:9"`（2026-05 寫的，比 T1 改 3:2 早兩個月，一直沒對齊）|
| `render.js` | 依 `activeTool` 分流，T1/T3 丟掉客戶端值、強制 `'3:2'` |
| 各模型轉接器 | 再自己判斷；`gpt-image-2` 完全不看比例、寫死 `size: '1536x1024'` |

任一處與實際圖片不符即失準。而 `crop_center_to_ratio` 整段包在 rescue 裡，
裁切失敗會**靜默保留原生視窗比例**，插件卻仍宣告 3:2 —— 宣告與事實脫節。

**修法（第一性原理：不宣告意圖，只描述事實）**

不變量：**出圖比例 = 實際送出去那張圖的比例。誰握有圖片，誰決定。**

- **後端為權威來源**：新增 `jpegDimensions`（掃 JPEG SOF 標記，無外部依賴）
  ＋ `resolveAspectRatio`。優先量圖，量不到才退回客戶端宣告值。
  **不可省**：1.4.74 以前的插件底圖模式一律送寫死 16:9，只信任客戶端會讓舊版用戶更糟；
  後端量圖即與插件版本脫鉤，無需協調。
- **插件端**：新增 `nearest_aspect_ratio` / `measure_aspect_ratio`（清單與 `app.js` 對齊），
  三個送出點全部改量實際檔案，payload guard 重新截圖後同步重新量。
- **移除**所有 `activeTool` 分流與寫死比例；`gpt-image-2` 改為在三種可用尺寸取最接近。

**已知模型限制（非程式錯，待定價決策）**
`gpt-image-2` 只有 1024x1024／1536x1024／1024x1536，做不出 16:9；
且以 `quality` 而非 `size` 分級，**1K/2K/4K 輸出同為 1536x1024**
→ 4K 扣 30 點卻與 1K 同尺寸。預設的 `nano-banana` 與 `seedream` 無此問題。

**驗證**：`ruby -c` / `node --check` / `check_cjs` 全過；Ruby 比例判斷 8 組全對；
後端以 4 個真實 JPEG 實測讀取正確；舊版插件宣告 16:9／1:1／null 三情境皆被實測覆蓋；
雲端底圖正確退回宣告值。**後端已部署上線**，插件端待發版。
診斷工具：`scripts/verify_aspect.rb`。

---

## 稽核附註（非任務，但需用戶裁決）

1. **`.claude/settings.local.json` 被改動**：新增了一條 Bash 權限。`CLAUDE.md` 明訂此檔「不由 agent 編輯/commit」，需由用戶自行確認是否保留。
2. **工作區有未提交改動會被下次 release 掃入**：`app.js` 與 `index.html` 含翻譯備援（MyMemory + Google fallback）、圖片預覽 fallback、cache-busting 改為時間戳三組改動，來源需先確認歸屬再決定是否納入。
3. **本 Sprint 初版缺少 `## RELEASE_GATE` 區塊**，違反 `CLAUDE.md` 決策樹第 2 步，已於下方補上。

---

## RELEASE_GATE

```
release_type: feature
verified_diff:
  - build_rbz.ps1
  - loamlab_plugin.rb
  - loamlab_plugin/config.rb
  - loamlab_plugin/main.rb
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/ui/index.html
  - loamlab_backend/api/render.js
  - loamlab_backend/api/version.js
  - loamlab_backend/public/360-viewer.html
  - loamlab_backend/public/share.html
  - loamlab_backend/public/images/hero-bg.jpg
  - loamlab_backend/public/images/after.jpg
  - loamlab_backend/public/images/multiangle_grid.jpg
  - loamlab_backend/public/images/multiangle_source.jpg
  - loamlab_backend/public/images/spacereform_after.jpg
  - loamlab_backend/public/images/spacereform_before.jpg
  - scripts/verify_save_chain.rb
  - scripts/verify_aspect.rb
  - .cursorrules
  - .gitignore
  - GEMINI.md
  - SPRINT.md
  - .agents/moat-strategy.md
  - .agents/product-marketing-context.md
sql_migration: false
```

> **v1.4.75 涵蓋 T0／T1／T2／T3／T6／T7／T8。**
> 判為 `feature` 而非 `hotfix`：跨插件端與後端多個模組，且含存檔鏈重整與出圖比例架構變更。
>
> 逐項實測紀錄：
> - `ruby -c` 全數 Syntax OK（本機已安裝 Ruby 3.1.7，與 SketchUp 2024 同版本）
> - `node --check` + ESLint(ES2019) 零錯誤；`check_cjs.ps1` 通過
> - 存檔鏈：`scripts/verify_save_chain.rb` 四區塊全過（用戶實機確認）
> - 出圖比例：`scripts/verify_aspect.rb` 掃 120 組成對圖，修復後樣本一致
> - 後端已先行部署，線上 `/api/version` 與首頁均正常
>
> `.agents/moat-strategy.md` 與 `product-marketing-context.md` 出現在 diff 是因為
> **從公開版控移除**（商業策略不該存在於公開 repo），非內容變更。
> T2 / T3 / T6 任一項完成後都要重填 `verified_diff` 並把 `release_type` 改成 `feature`——
> T6 會動到 `main.rb` 的存檔路徑和 `app.js`，不屬於 hotfix 範圍。

---

status: READY_FOR_REVIEW
