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

### `[x] [P0]` T9：render_history 靜默全滅五個月 — 真因是正式庫缺欄位（**2026-09-09 已修代碼，待跑 SQL**）

> **這是本輪最高風險項，而且不在 Gemini 提案的視野內。**
>
> - **實測**：`render_history` 全表只有 **16 列**，最新一列停在 `2026-04-09T15:29`；
>   同期 `transactions` 光是 2026-07-01 之後就有 **6577 筆 RENDER_\***。
> - **真因**（用 service role 直接 INSERT 測出來，不是推論）：
>   ```
>   PGRST204: Could not find the 'input_url' column of 'render_history' in the schema cache
>   ```
>   正式庫從來沒跑過 `supabase_setup.sql:184` 的 `ADD COLUMN input_url`。
>   2026-08-28 那次把 anon key 改成 service role **並沒有解決問題**——當時只驗到「RLS 不再擋」，
>   沒有實際 INSERT 一筆確認，所以又白漏了 12 天。
> - **連鎖風險（真金白銀）**：`stats.js` 的 `scan_render_anomalies` 用 `render_history` 判斷
>   「這筆扣款有沒有對應出圖」，查不到就自動退款、回溯 26 小時。`render_history` 是空的 ⇒
>   只要這支排程恢復運作，最近 26 小時內所有成功渲染都會被判成孤兒扣款、全額退點。
> - **修法**：
>   1. `supabase_setup.sql` 新增「Phase 31 正式庫補跑區」（冪等，含 `NOTIFY pgrst, 'reload schema'`）
>   2. `render.js` 抽出 `insertRenderHistory()` 作為 render_history 的唯一寫入入口：
>      收到 PGRST204 就把缺的欄位拿掉重試，並印出「正式庫缺欄位 X」。寧可少存一欄，也不能
>      整筆消失讓排程去退錯款。**一般渲染與 360 分享兩個呼叫端共用同一份**——原本 360 那支
>      （`render.js` 的 `create_360` 分支）是另一份 inline insert，同樣中招，抽出後不會
>      再有「改一邊漏一邊」。
> - **驗收**：以 `loamlabs@gmail.com`（scan 的 `noTestRef` 有排除，不影響退款判斷）實測
>   缺欄位情境 → 兜底觸發 → 寫入成功 → 測試列已刪除，總列數回到 16。

### `[x] [P0]` T10：Storage 1.4GB 超標 — 96% 是 render-temp 孤兒暫存檔（**2026-09-09 已清，代碼待部署**）

> **Gemini 提案把優先級搞反了**（`SPRINT_PROPOSAL.md` 把 `cleanup_360` 列 MUST、`render-temp` 列 NICE）。
> 實測用量：
>
> | bucket | 用量 | 檔數 | 佔比 |
> |---|---|---|---|
> | `render-temp/tmp/` | **1392 MB** | 5128 | **96%** |
> | `pano-360` | 54.5 MB | 67 | 4% |
>
> - **根因**：AtlasCloud 改非同步 `task_id` 後，抓圖時機落在 `poll_render`，而它是無狀態請求、
>   拿不到當初的暫存路徑 ⇒ 沒有任何人刪 `render-temp/`（`render.js:1083` 的 TODO 早就寫明了）。
>   簽名 URL 只活 1 小時，實測 6 小時內 0 檔、24 小時內僅 50 檔 ⇒ 超過 24 小時的全是死檔。
> - **提案 Task 1 若照做會出事**：現行 `cleanup_360` 用 `folder.created_at` 判齡，但 Supabase
>   `storage.list()` 對資料夾回傳的 `created_at` 一律是 `null`（實測 12/12）⇒ `new Date(null)`
>   等於 1970 ⇒ **所有全景圖都會被判成過期，包含當天剛分享出去的**。一掛上 cron 就全刪。
> - **修法**：
>   1. 新增 `lib/storageCleanup.js`：改以「資料夾內檔案的 created_at」判齡；`render-temp` 依
>      檔名（`Date.now()_亂數`，字典序＝時間序）截斷取最舊的一批，工作量可控
>   2. `render.js` 新增 `action=cleanup_temp`，並把 `cleanup_360` 改走同一個 lib
>   3. **不新增 cron**（Hobby 上限 2 條、已滿）——沿用 `stats.js:520` 既有的「搭便車跑在
>      `scan_render_anomalies`」做法，`vercel.json` 一行都不動
> - **已執行**：2026-09-09 直接以 service role 跑 `cleanupRenderTemp({hours:24})` 回填清理，
>   刪 5092 檔、釋放 **1379.6 MB**、耗時 75 秒、errors 0；24 小時內的 40 檔全數保留。
>   實測後 `render-temp` 13.9 MB、`pano-360` 54.5 MB，合計 **68 MB**（原 1.45 GB），
>   已遠低於免費方案 1.1 GB 紅線 ⇒ Supabase 的 Storage 超額告警信不再成立。
> - **全景圖保留期維持 7 天**（一度考慮放寬到 180 天，查證後確認不需要）：
>   原本的顧慮是「排程第一次跑會讓舊分享連結同時失效」。但實測證明**根本沒有用戶的雲端分享**：
>   最近 50 筆 `RENDER_360` 交易的 `metadata.type` **全部是 `local`**，且 `pano-360` bucket
>   最新檔案停在 2026-05-11、之後四個月沒有新增。出貨版工具 4 走的是本機匯出
>   （`main.rb` 的 `export_360_local`），雲端那條（`export_360_cloud`）程式碼還在但沒人走。
>   ⇒ 庫裡那 12 組 / 54.5MB 是 5 月的測試資料，不是用戶資產，照 7 天規則清掉即可。
>   dry-run 對照：180 天刪 0 檔、90 天與 7 天都刪光 67 檔 / 54.5MB。
>   ⚠️ **若日後真的開放雲端分享給用戶，這個 7 天就是玩真的**，屆時要確認 UI 有講清楚效期。
> - **待辦**：部署後確認排程有在跑（見 T11），否則清理只是一次性的、還會再堆回去。

### `[ ] [P1]` T11：每日排程疑似停擺（**需用戶到 Vercel 後台確認**）

> `daily_metrics` 最新一列是 `2026-08-27`，且 30 列的 `updated_at` 全部是 `2026-08-28T15:52`
> ——那是人工回填的時間戳，之後 12 天一列都沒新增。`cron_daily_metrics` 是
> `scan_render_anomalies` 進入後的第一件事，所以合理推論**這支每日排程自 2026-08-28 起就沒有
> 成功跑過**（要嘛沒被觸發、要嘛在鑑權那關就 401）。
>
> - **兩面刃**：排程停擺剛好擋下了 T9 的誤退款（`REFUND_AUTO_ANOMALY` 最新一筆停在
>   2026-07-14，且是人工批次）。但它一旦恢復、而 T9 的 SQL 還沒跑，就會立刻開始誤退款。
> - **因此順序不能顛倒**：先跑 T9 的 SQL，再處理排程。
> - **無法在本機查證**：`.env.local` 的 `VERCEL_ACCESS_TOKEN` 是空的，Vercel API 打不了。
>   請到 Vercel 後台 → 專案 → Cron Jobs 看最近一次執行狀態與回應碼。

### `[x] [P0]` T12：Disk IO 告警的真因不是索引，是 admin 儀表板在背景空轉（**2026-09-09 已修**）

> Supabase 同一天寄來**兩封不同的告警信**，Gemini 提案把它們混為一談：
>
> | 信 | 內容 | 真因 | 狀態 |
> |---|---|---|---|
> | Storage 超額 | 用量 1.11GB > 免費額度 1.1GB，10/9 起適用 Fair Use | render-temp 孤兒檔 | **已解決**（見 T10，1.45GB → 68MB）|
> | Disk IO Budget | IO 用量超過 compute add-on 能負擔的量 | 見下 | **已修主因** |
>
> **第一性原理**：Disk IO 預算計的是「讀寫次數」，跟「資料多大」無關。所以要問的不是
> 「哪張表沒索引」，而是「誰在高頻讀」。
>
> **實測否定索引假說**：全庫 16 張表加起來約 13,500 列，最大的 `transactions` 只有 10,475 列
> （幾 MB）。這種規模全表掃描是瞬間的事，吃不掉 IO 預算。更關鍵的是——`stats.js` 的分析查詢
> 一律帶 `.not('email','ilike','%testsprite%')` 排除測試帳號，**`ilike` 用不到 B-tree 索引**，
> Phase 26 那 6 個索引對這些查詢一點忙都幫不上。**Gemini 提案 Task 3 的因果推論不成立。**
>
> **真正的高頻讀取端**：`admin.html` 的自動刷新。
> - `admin.html:4052` 每 60 秒跑一次 `loadAll()`：10 個分析 action + 8 個設定讀取 = 18 個請求，
>   每個 action 內部 2~6 個查詢，且因為 ilike 條件全是全表掃描
> - `admin.html:4252` 另外每 30 秒抓一次 logs
> - **而且分頁切到背景照跑**——一個忘了關的分頁 = 每小時 1000+ 次請求、24 小時不停
> - 對照組：真實用戶負載每天只有 30~60 次渲染。儀表板的讀取量是真實業務量的百倍以上
>
> **修法（不改變任何看得到的行為）**：`document.hidden` 時整個暫停倒數與輪詢，切回分頁立刻補
> 刷一次。前景使用體感完全不變，背景空轉歸零。
>
> **仍未百分之百證實**：本機 `.env.local` 的 `ADMIN_KEY` 是空的，打不了線上 admin API 做量測。
> 最終確認方式是 Supabase → Reports → Database → Disk IO 圖，看高峰時段是否與開著 admin
> 分頁的時段吻合。但這個修法無論假說對錯都是純賺（背景空轉本來就沒有價值），故先行修掉。
>
> **索引照加**（已寫進 Phase 31）：無害、該補，但別期待它解決 IO。

### `[ ] [P2]` T13：兩張表在正式庫根本不存在

> 盤點時順手發現 `telemetry_events`、`kol_ledger` 兩張表 REST 一律回 404 ——
> `supabase_setup.sql` 裡有 `CREATE TABLE`，正式庫沒跑過。跟 T9 的 `input_url` 是同一種
> schema 漂移。目前沒有代碼在寫這兩張表所以沒造成災情，但**這代表「SQL 寫進 repo」和
> 「正式庫真的有」之間完全沒有任何機制保證一致**——T9 就是這樣漏了五個月才被發現。
>
> 建議（未做，待裁決）：要嘛把 Phase 31 的補跑區擴充成完整的「全表存在性檢查 + 補建」，
> 要嘛乾脆刪掉這兩張沒人用的表定義，別留著假象。

### `[x] [P0]` T14：渲染大量失敗（用戶回報）— 上游時段性故障，但真正的問題是「查不出來」（**2026-09-10**）

> **用戶回報**：alen3388@gmail.com 反應無法正常出圖；後台顯示大量失敗。
>
> **事件範圍**（可複驗，資料源 `transactions`）：2026-09-10 UTC 05:46–06:51，共 65 分鐘、
> 145 筆 `REFUND_NETWORK_ERROR`，影響 4 位用戶。之後自行恢復（07:00–09:30 的 21 筆 1K 僅 1 筆失敗）。
>
> | 用戶 | 失敗 | 點數結算 |
> |---|---|---|
> | alen3388 | 115（全 2K）| 116 扣 vs 115 退、0 成功 ⇒ **少退 20 點，已人工補回並補記交易**（9/10 淨額歸 0）|
> | riona | 20 | 已平（成功 14 × 15 = −210，對得上）|
> | hanaxyq | 7 | 已平 |
> | xudesign0113 | 3 | 已平 |
>
> **不是 9/9 那批部署的迴歸**，三項反證：
> ① 9/10 全天沒有任何部署（最近一次在 9/9）；② 9/9 部署後全天 58 扣款 / 46 成功 / **0 筆**網路錯誤；
> ③ Storage 假說否定——T10 清理後 `render-temp` 現僅 59 檔，沒有堆回去，不存在超額擋寫入。
> 失敗橫跨 1K/2K、T1/T2、四位用戶，且扣款→退款穩定間隔約 120 秒 ⇒ 特徵是上游 AtlasCloud 時段性異常。
>
> **但無法百分之百證實是哪一種異常（429？5xx？逾時？），這才是要修的東西**：
> `REFUND_NETWORK_ERROR` 的 metadata 只寫 `{tool_id}`，而 Vercel Hobby 沒有 log drain、
> runtime log 只留 1 小時 ⇒ 145 筆失敗過三小時後現場完全消失。後台看到一片紅卻查不出所以然，
> 同一個原因。**這次診斷之所以只能推論、不能斷言，就是被這個缺陷擋住的。**
>
> **修法**（純加法，不動金流邏輯、不新增函式/排程/資料表）：
> 1. `render.js` 主流程 catch：追蹤 `renderStage`（prepare／fetch_ref_images／atlas_request／
>    parse_response 四段）與耗時，連同 `http_status`、`resolution`、`err` 寫進 `transactions.metadata`
>    （本來就是 jsonb 自由欄位，**不會重演 T9 的 PGRST204**）。訊息一律過 `sanitizeError`。
> 2. 同一缺陷順手補另兩條路徑：`refundAndFail` 算好的 `reason` 原本只回前端不落地；
>    `REFUND_NO_URL` 把上游回應只丟給即將過期的 log。
> 3. `admin.html` 退款列直接顯示失敗摘要（`HTTP xxx · stage · err`），不必逐筆點開 alert 看 145 次。
>
> **驗證**：`node --check` PASS、`check_cjs.ps1` PASS（函式數維持 12/12）、admin.html inline script parse PASS。
>
> **未做（待裁決）**：alen3388 在 65 分鐘內重試了 115 次、每次都真的打上游又扣又退，
> 系統沒有任何熔斷或「引擎異常請稍後」的提示，用戶只看得到 sanitize 過的同一句話。
> 另 `CLAUDE.md` 列的 Gemini / Coze 備援至今「未實裝」，上游一掛就是全站掛。兩者都是行為改變，另案處理。

### `[x] [P0]` T15：alen3388 的「送出就失敗」不是渲染失敗 — 被擋在扣款之前，且完全隱形（**2026-09-10**）

> T14 收尾後用戶追問「所以問題解決了嗎」，並回報 alen3388 又試了一次、又失敗。
> **查下去發現 T14 的結論有漏洞**：
>
> 1. **「已恢復」的證據全部來自 1K**。故障時段（05:46–06:51）之外，今天根本沒有人試過 2K，
>    而 alen3388 那 115 次全是 2K。hanaxyq 的 3 筆 2K 也落在故障時段內，不能拿來當佐證。
>    → **已實測補上**：09:55:38 送出 2K、09:58:13 出圖成功（約 2 分 35 秒）。**2K 確認正常。**
> 2. **alen 最新那次失敗在 `transactions` 裡查不到任何東西**，`last_active_at` 停在 06:38
>    三個多小時沒動 ⇒ 請求根本沒進到渲染流程。
>
> **現場重現（非推論）**：故意用不符的 IP 打線上 `/api/render` → 401，
> 前後交易數 **254 → 254**，一筆痕跡都沒留。**IP pinning 這條路徑完全隱形**：
> 不寫交易、不寫歷史，後台一片空白，連「用戶有沒有送到後端」都無從得知。
> 用戶換 wifi／開手機熱點就會踩到，而且會反覆踩。
>
> **但不能宣稱 alen 就是 401**：Vercel 的 413（payload 過大）同樣在函式執行前被擋、同樣零紀錄，
> 兩者無法從現有資料區分。**所以修的是「不確定」本身，不是押一個猜測。**
>
> **修法**：IP 不符而拒絕時寫一筆 `feedback(type='auth_ip_blocked')`，帶 plugin_version 與前後 IP；
> admin 反饋記錄加「被擋登入」分頁。刻意 `await` 而非 fire-and-forget（serverless 回應後可能凍結，
> 同 `saveRenderHistory` 踩過的坑）。只有「真實存在且已綁過 IP」的帳號會走到這裡，隨機 email 打不進來。
>
> **刻意不動防護邏輯本身**：這道防線擋的是「知道 email 就能燒別人點數」，是錢的事；
> 目前只有一個疑似誤擋案例、尚未證實，憑感覺放寬不負責任。**先量測誤擋有多普遍，再決定**。
> 根本解是插件改帶 `otp.js` 登入時已簽發的 Supabase session token（`resolveUserEmail` 已支援，
> 插件端沒存也沒送），走 token 就完全繞過 IP pinning——但那要改插件、發版。
>
> **驗證**：`node --check` PASS、admin.html parse PASS；對正式庫實測 `feedback.type` 接受新值
> （repo 的 SQL ≠ 正式庫，T9 的教訓），探針已刪；部署後端到端實測 401 確實留下紀錄，測試痕跡已清除。
>
> **下一步的二分法**：請 alen 重新登入後再試一次。
> 後台「被擋登入」出現他 ⇒ 就是 IP pinning；沒出現 ⇒ 排除 401，指向 413 或插件端，再往那邊查。

### `[x] [P0]` T16：後台把「扣款成功」謊報成「出圖成功」— 假數據比沒數據更危險（**2026-09-10**）

> 用戶提供日誌截圖時發現：alen3388 的 `RENDER_2K` 在後台全部標著「✅ 成功」，
> 但他的 `render_history` **全時間 0 筆**，一張圖都沒出過。
>
> **根因**：`admin.html` 的 `statusBadge` 是「不是 REFUND、不是 TOPUP ⇒ 一律標成功」。
> 但 `RENDER_*` 只是扣款紀錄，跟 AI 有沒有生出圖片無關。於是 116 筆全滅的渲染在後台呈現為
> 「成功／退款／成功／退款」交錯，**看起來像時好時壞，實際上是全滅**——會把「全滅」誤判成
> 「間歇性問題」，直接誤導處置方向。
>
> **修法**：`RENDER_*` 改標中性的「已扣款」；`request_log` 附上彙總（扣款／出圖／退款／出圖率），
> 出圖數取自 `render_history`（出圖的唯一憑證）。逐筆配對做不到——批量同秒送出多筆、
> `render_history` 沒有 `transaction_id` 可對——所以給區間統計而非逐列判定：**寧可少說，不可謊報**。
> 兩個刻意的防呆：① 三個數字都走不受列表 limit 200 影響的 count 查詢，避免生出
> 「扣款 200 / 出圖 500」這種新假數據；② 沒選日期時預設落在最近 24 小時，**不可**用全部歷史——
> `render_history` 在 2026-04-09～09-09 有五個月空洞（T9），拿它除以全時間扣款會算出假的個位數
> 出圖率並亮紅燈，那正是本任務要根治的問題本身。
>
> **驗證**：以 service role 模擬同條件查詢，最近 24 小時扣款 226 / 退款 149 / 出圖 76
> （出圖率 34%、紅燈），與實際相符；`node --check`、admin.html parse 皆 PASS；部署後端點存活。
>
> **附帶結清**：hanaxyq 今日 1K 為 23 扣 / 4 退 / 18 出 ⇒ 1 筆懸空（15 點），已補回並補記交易，
> 淨額回到 −270（＝18 × 15，完全對上）。成因見 T17 第 2 項。

### `[ ] [P0]` T17：本輪盤點出的潛在問題（**尚未處理，需裁決**）

> 1. **每日排程仍然停擺，而且是三重後果**（T11 的延伸，已升級為 P0）
>    - 證據：`daily_metrics` 停在 **2026-08-27**（14 天）；`REFUND_AUTO_ANOMALY` 最新一筆停在
>      **2026-07-14**（近兩個月，且那是人工批次）
>    - 後果 A：**孤兒扣款無人回收**。今天 hanaxyq 那 15 點本來就該由排程自動退，實際上是靠人工盤點才發現
>    - 後果 B：**Storage 清理是搭這條排程的便車**（T10），所以也沒在跑。
>      `render-temp` 實測一小時內 59 → **64 檔**，持續堆積中，照這個速度會再回到 1.4GB
>    - 後果 C：`daily_metrics` 沒更新 ⇒ 數據看板本身就是舊的
>    - **待辦**：到 Vercel 後台 → Cron Jobs 看最近執行狀態與回應碼，區分「沒被觸發」還是「執行失敗」
> 2. ~~**前端等滿 6 分鐘就放棄，而且不退款**~~ → **已於 T19 修復**
>    - `app.js:6585` `_pollRenderTask` 為 `maxAttempts=120 × 3 秒 = 360 秒`，逾時回
>      `points_refunded: false`，訊息是「渲染仍在處理中，請稍後至 Render History 查看結果」
>      ——但任務沒完成，那裡**不會有東西**
>    - ⇒ 扣了錢、沒圖、不退款、還把人導去一個空頁面。這就是 hanaxyq 那筆懸空的成因
>    - 而唯一的安全網（`scan_render_anomalies` 的孤兒掃描）正好停擺 ⇒ 用戶默默損失，我們也不會知道
> 3. **2K 對上游劣化極度敏感**：故障時段 2K **118 筆 100% 全滅**（alen 115 + hanaxyq 3），
>    同時段 1K 只是部分失敗（riona 34 扣 / 14 出）。實測正常 2K 需 **2 分 35 秒**，
>    上游一慢就整批倒。是否要在 2K 連續失敗時自動降級或明確提示，待裁決。
> 4. **`x-vercel-cron` 這道鑑權可能可被偽造**（`stats.js:518`）：`scan_render_anomalies` 只認
>    `x-vercel-cron: 1` 或 `ADMIN_KEY`。若 Vercel 未剝除外部傳入的同名 header，任何人都能觸發
>    這支**會真的執行退款**的端點。業界做法是改用 `CRON_SECRET`。
>    **刻意未實測**——實測等同於嘗試未授權觸發生產端點。
> 5. **alen3388 是 pro 訂閱用戶，今天 116 次、0 出圖**，且是主動回報的人。流失風險高。
> 6. **重試風暴無熔斷**：他 65 分鐘內打了 116 次，每次都真的打上游、真的扣款再退款。

### `[x] [P1]` T18：人工補點借用了故障類型，自己製造出一次假故障（**2026-09-10 已收拾**）

> 用戶回報「又有用戶遇到同樣的問題」，附上兩張後台截圖。查證後**兩筆都是我自己補的帳**
> （metadata 帶 `manual: true` / `reconciled by hand`，時間正是 09:44 與 10:44 的補點時刻）。
>
> **根因是我的判斷失誤**：補點時為了讓「116 扣 = 116 退」自然對平，直接借用了
> `REFUND_NETWORK_ERROR`。代價是那兩筆混進後台的失敗列表，看起來就是新故障——
> **故障列表的價值在於「裡面每一筆都是真的故障」，摻進人工紀錄就毀掉這個性質**，
> 而且反過來誤導了判讀，讓用戶多回報了一次不存在的問題。
>
> **修法**：兩筆改為既有的 `REFUND_MANUAL_COMPENSATION`。該類型已在 `stats.js:531` 的
> `REFUND_TYPES` 白名單內，所以 `scan_render_anomalies` 仍認它為「已處理」，
> **不會把這兩筆重新當成孤兒扣款而重複退款**——換任何不在白名單裡的新類型都會踩到這個雷。
>
> **驗證**：改完後今日 `REFUND_NETWORK_ERROR` 為 145 筆、最新一筆停在 06:51，
> 全部落在故障時段內，失敗列表恢復乾淨；alen 淨額仍為 0、hanaxyq 仍為 −270。
>
> **同時確認系統正常**：09:52 部署後零真實失敗、零 `auth_ip_blocked`；
> susan3229（10:02 扣款→10:03 出圖）、kyle84112322（12:27→12:31 出圖）皆正常。
> 已記入 memory `feedback_manual_refund_type`，避免再犯。

### `[x] [P0]` T19：逾時任務主動退款 + 修好從沒生效過的成本記錄（**2026-09-10 已部署驗證**）

> 三項，都是查證後才動手：
>
> **1. 前端放棄之前主動退款（解決 T17 第 2 項）**
> `app.js` 的 `_pollRenderTask` 是 120 次 × 3 秒 = 6 分鐘就放棄，且放棄時回
> `points_refunded: false`、訊息叫用戶「稍後至 Render History 查看」——但任務沒完成，
> 那裡不會有東西。淨結果是扣了錢、沒圖、不退款、還導去空頁面（hanaxyq 的 15 點就是這樣沒的）。
> - 判齡用 **AtlasCloud 自己回的 `created_at`**（debug 模式實測確認存在，
>   形如 `"2026-09-10T09:55:41.552Z"`，同一回應還有 `completed_at` 與 `latency_ms`）
> - **刻意不用**前端傳的 `started_at`：那是客戶端時鐘，使用者電腦慢一小時就會讓剛送出的任務
>   立刻被誤判逾時而退款。拿不到 `created_at` 就什麼都不做——**寧可漏退，不可誤退**
> - 門檻 5.5 分鐘（實測正常 2K 為 2 分 35 秒 / `latency_ms 127904`），卡在前端放棄之前
>
> **2. `provider_cost_usd_cents` 從來沒寫進過真實值**
> AtlasCloud 回的成本欄位叫 **`price`**（實測 `"price": "0.072"`，字串），而程式碼只找
> `cost / usd / cost_usd / metrics.cost`，**一個都對不上** ⇒ 實測 9/9 之後 103 筆全是 `null`
> ⇒ admin 看板的「成本 / 淨利」KPI 等於**成本恆為 0、淨利＝營業額**，又一份假數據。
> 諷刺的是 `c18d40e` 當初修的正是「Cost KPI 永遠 0」，但欄位名猜錯，所以一直還是 0。
> 兩個出圖路徑都補上。
> **端到端實測**：修復前（09:58 的 2K）`null` → 修復後（12:45 的 1K）**14** cents。
>
> **3. `vercel.json` 補 `stats.js` 的 `maxDuration: 60`**
> 它一直吃 Vercel 預設（10 秒），而排程裡已經串了 `cron_daily_metrics` + 孤兒掃描 +
> 兩支 storage cleanup。**這不是排程停擺的根因**——`cron_daily_metrics` 只算前一天、
> 5 個查詢，在這個 13,500 列的小庫上跑不到 10 秒，**該假說已自行否定**。純粹是保險。
>
> **驗證**：`node --check` PASS、`vercel.json` 合法 JSON、`check_cjs.ps1` PASS（12/12）、
> 部署後實跑一張 1K 端到端確認成本入帳。

### `[x] [P0]` T20：從第一性原理重整 — 建立「系統會說謊」的自我偵測（**2026-09-10 已部署**）

> **問題陳述**：當天查出九個問題——渲染失敗查不出原因、被擋登入完全隱形、後台把「扣款」
> 謊報成「出圖成功」、成本 KPI 從來就是 0、`render_history` 靜默全滅五個月、每日排程停擺
> 14 天、Storage 堆到 1.4GB、前端放棄卻不退款、`kol_ledger` 整張表不存在。
>
> **第一性原理**：這不是九個獨立的 bug。共同根因是同一件事——
> **系統會說謊或沉默，而沒有任何機制會發現這件事。**
> 逐個修完，下次還會有第十個。所以這次建的是「主動發現說謊」的機制本身。
>
> **關鍵設計：pull，不是 push。** 既有監控全掛在 `scan_render_anomalies` 那條排程上，
> 而那條排程本身已經壞了 14 天沒人知道——**監控不能依賴被監控的東西**。
> 故做成「打開後台就當場算」（`GET /api/stats?action=health`），即使 Vercel cron 永遠修不好，
> 一開後台就看得到真相。
>
> **七項檢查**（全部基於事實查詢）：資料表 / 欄位完整性、點數對帳、出圖率、成本記錄管線、
> 每日排程存活、Storage 堆積、被擋登入。
> - 「表存在」不夠——T9 缺的是**欄位**（`input_url`），所以連 5 組關鍵欄位一起查，
>   已對正式庫逐組實測全部存在、不會誤報
> - 刻意**不進** `loadAll()`：那支每 60 秒跑一次，T12 查過它正是 Disk IO 最大來源。
>   health 只在登入時跑一次，要重看按「重新檢查」。全綠時只留一行灰字，不佔版面
> - 未新增 `api/*.js`（函式數維持 12/12）
>
> **部署當下的預期輸出**（以 service role 逐項模擬算出，供對照驗收）：
> 資料表 🔴 `kol_ledger` 不存在｜點數對帳 🟢 220−150−71 = −1（無人被吃點數）｜
> 出圖率 🔴 71/220 = 32%（今早故障殘留，24h 窗口會自行滾掉）｜成本管線 🟡 1/73｜
> 每日排程 🔴 停在 08-27｜Storage 🟢 64 檔｜被擋登入 🟢 0

### `[ ] [P0]` T21：本輪新查出、需用戶動手的風險（**2026-09-10**）

> 1. **`kol_ledger` 整張表在正式庫不存在**（PGRST205 實測）。`lib/activate.js:440` 的
>    `writeKolCommission` 照寫不誤，`catch` 只 `console.warn` ⇒ **與 T9 完全同一種病**。
>    - 現有 **6 位 KOL / partner**（`911016wiwi` 是 partner，分潤 15–25%），
>      目前 `referral_success_count` 全為 0 ⇒ **尚未造成實際損失**，但一成交佣金紀錄就永久消失，
>      屆時你算不出該付多少
>    - **DDL 已在 `supabase_setup.sql:230-246`，只是正式庫從沒跑過**。需在 Supabase SQL Editor 執行
>    - 修好後 health 的「資料表 / 欄位完整性」會自動轉綠——這也是驗收方式
> 2. **`render.js` 完全沒有速率限制**：`lib/rateLimit.js` 存在但 render.js 沒用上，
>    所以 alen 能在 65 分鐘打 116 次、每次真扣真退。加限制會誤傷正常批量用戶，**需裁決**。
> 3. **每日排程停擺的根因仍未定**（見 T17 第 1 項），需 Vercel 後台 Cron Jobs 執行紀錄。
>    逾時假說已自行否定。
>
> **已查證無害、不需處理**（記錄以免日後重查）：
> - `webhook_errors` 18 筆未解決中 **17 筆是測試帳號**（`test@acme.com` / `test@example.com`），
>   唯一真實的 `therahuang@gmail.com`（08-28，payments 表當時剛建、schema cache 未更新）
>   **點數與 payments 事後都有補上**，無損失。惟測試垃圾會淹沒真問題，可考慮清理
> - `payments`(143) 與 `TOPUP_*`(151) 差 8 筆**不是遺漏**：`payments.order_id` 是
>   `sub_xxx_2026-05` 這種帶年月的去重鍵，同一訂閱同月只記一筆，屬設計行為

---

## 稽核附註（非任務，但需用戶裁決）

1. **`.claude/settings.local.json` 被改動**：新增了一條 Bash 權限。`CLAUDE.md` 明訂此檔「不由 agent 編輯/commit」，需由用戶自行確認是否保留。
2. **工作區有未提交改動會被下次 release 掃入**：`app.js` 與 `index.html` 含翻譯備援（MyMemory + Google fallback）、圖片預覽 fallback、cache-busting 改為時間戳三組改動，來源需先確認歸屬再決定是否納入。
3. **本 Sprint 初版缺少 `## RELEASE_GATE` 區塊**，違反 `CLAUDE.md` 決策樹第 2 步，已於下方補上。

---

## RELEASE_GATE

```
release_type: hotfix
verified_diff:
  - loamlab_plugin/ui/app.js
  - loamlab_plugin/config.rb
  - loamlab_plugin.rb
  - loamlab_backend/api/version.js
  - scripts/verify_dpi_calibration.js
  - SPRINT.md
  - SPRINT_PROPOSAL.md
sql_migration: false
```

> **v1.4.76 — Smart Canvas 高 DPI 游標消失修復（單一根因 hotfix）。**
>
> 判為 `hotfix` 而非 `feature`：只動插件端座標換算，不新增功能、不碰後端邏輯、
> 不碰金流／點數／存檔鏈。後端 diff 僅 `version.js` 的版本號字串。
>
> **根因**：SketchUp 舊版 CEF 在 Windows 顯示縮放（125%／150%）下，滑鼠事件座標是實體像素、
> 版面量測是 CSS 像素，兩者差一個固定倍率，而代碼一直把它當成 1。游標滑到畫布實體 2/3 處，
> 算出的座標已抵達圖片右緣，再往右就畫不出來——右側 1/3 成為死區。
> 過去的解法是請用戶去勾 SketchUp.exe 的「覆寫高 DPI 縮放行為」，代價是整個 SU 介面變模糊。
>
> **修法**：`DPIFix` 從滑鼠事件本身把倍率量出來
> （`f = (clientX − offsetX) / rect.left`，同一事件內即可解出），套用在原有的 `offsetX` 換算路徑上。
> 用戶不需要做任何設定。
>
> **為什麼下檔風險為零**：`_scGetXY` 保留原本的 `offsetX` 路徑、只多除一個倍率——
> 除以 1 就是修復前的算式。四種可能的現實（兩量皆乾淨／皆污染／只有其一污染）中，
> 結果不是「修好」就是「與 v1.4.75 逐位元相同」，沒有任何一種會變得更糟。
>
> 逐項實測紀錄：
> - `node scripts/verify_dpi_calibration.js` 全數通過；其第 6 節直接從 `app.js` 抽出
>   **實際出貨**的 `DPIFix` 與 `_scGetXY` 跑端到端，重現修復前「2/3 處 docX 已達 1920
>   （圖寬 1920）＝死區」，並確認修復後 2/3 處為 1280、最右緣剛好 1920
> - 100%／125%／150%／175%／200% 五種縮放皆在第 5 個 mousemove 定案，定案後自動移除監聽
> - 對抗性情境（`clientX` 與 `offsetX` 不同源）8000 段模擬 hover、事件污染率最高 50%，
>   採信錯誤倍率 **0 次**，一律安全退回 factor = 1
> - ESLint（ES2019）零錯誤
> - 尚未在真實 150% 硬體上驗收——這是刻意接受的：最壞情況等於現況，
>   實機只需看 `DPIFix.factor` 一個數字（150% 機器應為 1.5）
>
> 前一版 v1.4.75 的 RELEASE_GATE 紀錄（T0/T1/T2/T3/T6/T7/T8，含存檔鏈重整與出圖比例修復）
> 見 git tag `v1.4.75` 的 SPRINT.md。

---

status: READY_FOR_RELEASE
