# Smart Canvas 游標消失 / 標註落點偏移 — 修復方案

**用戶症狀**：在 Windows 顯示縮放 125%／150% 的機器上開 Smart Canvas，游標圈滑到圖片右側
約 2/3 處就消失，右邊 1/3 標不到，標註落點也跟游標對不上。目前只能叫用戶去改
「SketchUp.exe → 覆寫高 DPI 縮放行為」，代價是整個 SketchUp 介面變模糊。**這個要求要拿掉。**

---

## 一、根因：一個被當成 1 的倍率

畫布要把「滑鼠在哪」換算成「圖片上的哪一點」，用的是：

```
圖片座標 = (滑鼠位置 − 畫布左緣) × (圖片寬度 ÷ 畫布顯示寬度)
```

問題是這條式子裡的量來自兩個不同的地方：

- **滑鼠位置**（`clientX` / `offsetX`）來自事件系統
- **畫布左緣、畫布顯示寬度**（`getBoundingClientRect`）來自版面引擎

正常瀏覽器兩邊單位一樣。SketchUp 舊版 CEF 在 Windows 縮放下，事件那邊變成實體像素、版面那邊
還是 CSS 像素，**兩者差一個固定倍率 f**（150% 時 f = 1.5）。現行代碼從頭到尾把 f 當成 1。

f = 1.5 時，滑鼠走到畫布實體 2/3 處，算出來的座標就已經到達圖片右緣——**再往右畫，座標超出
圖片範圍，游標圈就畫不出來了**。這就是「游標消失」。

改 SketchUp.exe 的 DPI 設定之所以有效，是它強迫 f 變回 1。所以：**只要把 f 量出來，
使用者就完全不必碰系統設定。**

---

## 二、最簡單的修法：一行公式

同一個滑鼠事件裡，瀏覽器同時給了兩個數字：

- `e.clientX`：滑鼠距離**視窗**左緣多遠
- `e.offsetX`：滑鼠距離**目前這個元素**左緣多遠

兩者相減，剩下的就是「元素距離視窗左緣多遠」——而這段距離，`getBoundingClientRect().left`
也知道，且它是 CSS 像素。兩邊一除，倍率就出來了：

```
f = (clientX − offsetX) ÷ rect.left
```

**一個滑鼠事件就能算出來，不用累積、不用迭代、不用猜。**

### 實測（`node scripts/verify_dpi_calibration.js`，全部通過）

| 測試 | 結果 |
|---|---|
| 100%／125%／150%／175%／200%／250% 六種縮放 | **單一事件即精確量出**，誤差 0.000 |
| 健康機器（100%），3000 次事件 | **恆為 1**，一次都沒亂動 |
| 元素貼齊視窗邊緣（分母太小） | **正確跳過不採樣** |
| 30% 事件被隨機破壞 | 採信錯誤倍率 **0 次** |
| 50% 事件被隨機破壞 | 採信錯誤倍率 **0 次** |
| `clientX` 與 `offsetX` 被不同倍率污染的假想情況 | **誤採信率 0.0%**，安全退回 f = 1 |

---

## 三、三個安全閥（為什麼不會弄巧成拙）

1. **分母太小就不算**：`rect.left` 或 `rect.top` 小於 100px 的元素直接跳過，避免除法失準。
2. **X 軸、Y 軸算出來要一樣**：兩個軸用的是兩段長度不同的距離，健康情況下必然算出同一個
   倍率；不一致代表這個模型在這台機器上不成立，直接放棄。
3. **要有五票完全相同才採用**：倍率是個固定常數，正常情況每次算出來本來就該一模一樣。
   湊不齊就維持 f = 1，也就是**今天的行為**——修不好，但絕不會比現在更糟。

---

## 四、使用者要做什麼

**什麼都不用做。** 沒有設定項、沒有提示、沒有校正步驟、不必改 Windows DPI、不必重啟
SketchUp。滑鼠一動就量完了，使用者不會知道這件事發生過。

視窗拖到另一台不同縮放的螢幕也會自動重算。

---

## 五、執行計畫

### [MUST] T1 — 加入倍率量測，並統一座標入口

**檔案**：`loamlab_plugin/ui/app.js`

```js
// ── DPIFix：量出「滑鼠事件座標」與「CSS 版面座標」之間的倍率 ─────────────
// SketchUp 舊版 CEF 在 Windows 顯示縮放下，滑鼠事件給的是實體像素、版面量測給的是
// CSS 像素，兩者差一個固定倍率。同一個事件裡 clientX 與 offsetX 只差「元素左緣」
// 這一段，而元素左緣 rect.left 是 CSS 像素 —— 相減再一除，倍率就出來了。
// 任何算不準的情況一律維持 factor = 1（＝修復前的行為），只會修好、不會弄壞。
const DPIFix = {
    factor: 1,
    _votes: [],
    MIN_ANCHOR: 100, AGREE: 0.01, QUORUM: 5, WINDOW: 9,

    observe(e) {
        const el = e.target;
        if (!el || !el.getBoundingClientRect || e.offsetX === undefined) return;
        const r = el.getBoundingClientRect();
        const L = r.left + (el.clientLeft || 0);   // clientLeft＝左框線寬；offsetX 由 padding 緣起算
        const T = r.top  + (el.clientTop  || 0);
        if (L < this.MIN_ANCHOR || T < this.MIN_ANCHOR) return;   // 分母太小，除法不穩
        const fx = (e.clientX - e.offsetX) / L;
        const fy = (e.clientY - e.offsetY) / T;
        if (!(fx > 0) || !(fy > 0)) return;
        if (Math.abs(fx - fy) / fx > this.AGREE) return;          // 兩軸不一致 → 模型不成立
        const f = +(((fx + fy) / 2)).toFixed(2);
        if (f < 0.95 || f > 4) return;
        this._votes.push(f);
        if (this._votes.length > this.WINDOW) this._votes.shift();
        const tally = new Map();
        for (const v of this._votes) tally.set(v, (tally.get(v) || 0) + 1);
        for (const [v, n] of tally) if (n >= this.QUORUM) { this.factor = v; return; }
    },

    // 事件座標 → CSS 座標。所有 clientX / clientY 的讀取都必須經過這裡。
    toCss(e) {
        const t = (e.touches && e.touches[0]) || e;
        return { x: t.clientX / this.factor, y: t.clientY / this.factor };
    }
};
```

接線兩處：

1. Smart Canvas 開啟時掛一個被動監聽：
   `document.addEventListener('mousemove', (e) => DPIFix.observe(e), true);`
   掛在 `document` 而不是畫布上——公式對任何元素都成立，使用者從側欄移向畫布的路上就量完了。
2. `_scGetXY` 改寫，**刪掉 offsetX 分支**（那條路徑同樣被倍率污染，是前一次修復失敗的原因）：

```js
function _scGetXY(e) {
    const p = DPIFix.toCss(e);
    const rect = SmartCanvas.drawCanvas.getBoundingClientRect();
    return {
        x: Math.round((p.x - rect.left) * SmartCanvas.canvasW / rect.width),
        y: Math.round((p.y - rect.top)  * SmartCanvas.canvasH / rect.height)
    };
}
```

**驗收（150% 縮放實機）**：游標圈全程貼著實體滑鼠、不消失；畫布最右緣與最下緣都標得到；
使用者沒有改任何 Windows 設定。100% 機器上行為與 v1.4.75 完全一致。

---

### [MUST] T2 — 把其餘直接讀 `e.clientX` 的地方換掉

**檔案**：`loamlab_plugin/ui/app.js`

T1 只修了畫布內的落點，以下也走同一個倍率：

| 位置 | 目前寫法 | 症狀 |
|---|---|---|
| 6196-6197、6206-6207、6218-6219、6273-6274、6326-6327 | `_lastClientX = e.clientX` | 標籤輸入框彈出位置偏移 |
| 6202、6281、5130 | `_scFinalizeNodeShape(e.clientX, …)` | 同上 |
| 6245 | `const clientX = e.clientX`（矩形工具） | 同上 |
| 6340、6343 | `_altResizeStartX` / `delta = e.clientX − …` | Alt+拖曳調筆刷粗細，速度快 1.5 倍 |
| 4875-4897 | 圖片框選 overlay `e.clientX − r.left` | 虛線框跟不上滑鼠 |

作法：全域搜尋 `e.clientX` / `e.clientY` / `.touches[0].clientX`，一律改走 `DPIFix.toCss(e)`。
不逐行維護清單，之後新增的代碼也不會再漏。
`_scShowLabelPopup` 裡的 `window.innerWidth` 屬版面座標，**不要改**。

**驗收**：標籤輸入框貼著筆觸終點彈出；Alt+拖曳的線寬變化速度與 100% 機器一致；
圖片框選虛線框貼合滑鼠。

---

### [選配] T3 — 順手修同源的第二個問題

`_scApplyStackSize()` 用 `window.devicePixelRatio` 執行「顯示最多 1:1」規則。若 CEF 在同一批
機器上把 dpr 謊報成 1，這條保護會失效，弱 GPU 機器載大圖可能撞上合成層邊長上限而破圖。

SketchUp Ruby 端有 `UI.scale_factor`（SU2019+，已確認符號存在於本機 SketchUp 2024），
由 SU 主程式提供、不經過 CEF：

```ruby
# main.rb 的 getInitialData response hash 內
scale_factor: (UI.respond_to?(:scale_factor) ? UI.scale_factor : nil),
```

前端 `_scApplyStackSize()` 改用 `Math.max(window.devicePixelRatio || 1, hostScaleFactor || 1)`。

**T1 不依賴 T3**——T1 的公式完全不讀 `devicePixelRatio`，刻意不把修復建立在一個
已知可能說謊的數值上。這一項可以之後單獨做。

---

## 六、這個方案錯了會怎麼被發現

實機一測就知道，不必再靠推論。看 `DPIFix.factor` 一個數字即可：

| `factor` 的值 | 代表什麼 | 下一步 |
|---|---|---|
| 停在 1，游標仍消失 | 五票湊不齊，代表 `clientX` 與 `offsetX` 不同源 | 改走 T3 的 `UI.scale_factor` 當外部真值 |
| 量到 1.5，但落點反而更歪 | `rect.width` 也被污染，基準選錯 | 改以 `canvas.width ÷ target.clientWidth` 為基準重推 |
| 在 1 與 1.5 之間跳動 | 兩軸吻合門檻 `AGREE` 太鬆 | 收緊到 0.005 |

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
sql_migration: false
```

> 判為 `hotfix`：單一根因的座標修復，不新增功能、不動後端、不動存檔鏈。
> T3 若一併做會多動 `loamlab_plugin/main.rb`，屬同一根因範圍內。

---

## 實作進度

- [x] **T1** — `DPIFix` 模組 + `_scGetXY` 套用倍率（`app.js`）
- [x] **T2** — 其餘 `e.clientX` 直接引用全部改走 `DPIFix.toCss`（標籤彈窗定位、Alt+拖曳線寬、圖片框選 overlay）
- [ ] **T3**（選配）— `UI.scale_factor` 注入，供 `_scApplyStackSize` 使用
- [ ] 150% 實機驗收
- [ ] 版本號遞增 + 打包發佈

**設計上與提案的一處差異**：`_scGetXY` 保留原本的 `offsetX` 路徑、只多除一個倍率，
而非改走 `clientX`。原因是萬一實際情況是「`offsetX` 乾淨、`clientX` 被污染」，倍率會量不出來
而停在 1，此時 `clientX` 路徑反而比修復前更糟。除以 1 與修復前逐位元相同，沒有回歸風險。

**驗證**：`node scripts/verify_dpi_calibration.js` 全數通過，其中第 6 節直接從 `app.js`
抽出實際出貨的 `DPIFix` 與 `_scGetXY` 跑端到端，重現了修復前「游標在 2/3 處 docX 已達 1920
（圖寬 1920）＝右側死區」，並確認修復後 2/3 處為 1280、最右緣剛好 1920。
ESLint（ES2019）通過。

---

status: IMPLEMENTED_PENDING_QA
