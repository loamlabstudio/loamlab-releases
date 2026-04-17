# LoamLab Camera — 高級與驚奇 (Premium & Wow) 色彩與 UX 系統

> **設計哲學**：
> 面對極度挑剔的室內/建築設計師，UI 必須「克制卻充滿力量」。
> **高級感 (Premium)** 來自於日常狀態下的極簡、低調與極致的層次（深灰、純黑與毛玻璃）；
> **驚奇感 (Wow)** 則來自於觸發 AI 魔法時（渲染中、生成遮罩），介面上像流體一般活過來的「次世代霓虹發光」與「星雲漸層」。

---

## 🎨 1. 核心色彩計劃 (Color Palette)

### 🌑 1.1 空間基底 (Space & Depth) — 營造深邃的高級感
設計工具應該是畫布的背景，不能喧賓奪主。我們放棄死黑，採用帶有極微弱金屬光澤的「曜石黑」。
- **基底背景 (App Background)**: `#09090B` (Zinc-950) - 最深邃的黑，讓圖片對比更強烈。
- **懸浮面板 (Glass Panel)**: `rgba(24, 24, 27, 0.65)` (Zinc-900 /w 65% opacity) - 搭配 `backdrop-blur-xl`，製造高靈敏度的毛玻璃質感。
- **邊界光澤 (Border Edge)**: `rgba(255, 255, 255, 0.06)` - 面板邊緣那一絲微弱的反光，是區分「普通暗色容器」與「高級視窗」的關鍵。

### 🔦 1.2 內容層次 (Typography) — 呼吸感
- **主標題/核心數據 (Primary)**: `#FAFAFA` - 絕對清晰、銳利。
- **次要文字/標籤 (Secondary)**: `#A1A1AA` (Zinc-400) - 低調、不搶眼但在閱讀時毫不費力。
- **禁用/提示 (Muted)**: `#52525B` (Zinc-600) - 退居二線的元素。

### 🔥 1.3 品牌核心行動色 (Call-to-Action) — 力量與血脈
- **緋紅巨星 (Crimson Neon)**: `#E11D48` (Rose-600) 至 `#FF2A55`
  - *應用*：主要的「Start Engine 渲染按鈕」、核心 Icon。
  - *特性*：飽和而充滿張力。當 Hover 時，伴隨一圈 `#E11D48` opacity 30% 的 Glow 光暈（外發光），如同喚醒了一具跑車引擎。

### ✨ 1.4 魔法與驚奇狀態 (The Wow Factor) — AI 運算中的視覺震撼
當用戶點擊渲染，系統不該只是死板地跑進度條。這是 AI 展現魔法的時刻。
- **星雲漸變流體 (Nebula Flow)**: `linear-gradient(135deg, #EC4899 0%, #8B5CF6 50%, #3B82F6 100%)` (Pink → Purple → Blue)
  - *應用*：當渲染進度條在跑時，或者分析場景時。進度條不再是單調的紅色，而是一條流動的、會閃爍 (Shimmering) 的星雲漸變色。
  - *驚奇感*：暗示背後有龐大的 AI 在進行多維度神經網路運算。
- **琥珀流金 (Amber Glow)**: `#F59E0B`
  - *應用*：付費升級牆 (Paywall)、獲取代幣 (Earn Points)、提取材質 (Extract) 等與「價值」直接相關的操作。給予高貴的黃金質感回饋。

---

## 🎭 2. 色彩的 UX 情境映射 (State Mapping)

### State A: 靜默與構思 (Idle / Setup)
**（冷峻、高級、克制）**
用戶在勾選場景、調整 Prompt 與筆刷時，介面 90% 處於暗色系。
- 只有被選中的工具 (Tool) 會有微弱的 `border-bottom: 2px solid #E11D48`。
- 輸入框未被選中時只有白灰色邊界，Focus 時發出非常微弱的白光 `box-shadow: 0 0 0 2px rgba(255,255,255,0.1)` 而非傳統的藍框。

### State B: 點火啟動 (Ignition / Rendering)
**（澎湃、驚喜、科技感）**
這是用戶按下了「Start Engine」的時刻，我們要讓他覺得這「15 點數」花得非常有儀式感。
- **按鈕變化**：原本紅色的按鈕縮小一點 (Active)，然後開始散發「心跳脈衝 (Pulse)」效果的紅暈。
- **全屏氛圍**：背景 `main-preview-area` 四周泛起極難以察覺的微光漸層（Vignette glow），這是一種光學效應，讓中間的渲染進度條成為視覺絕對中心。
- **進度回饋**：加載條使用 `Nebula Flow`，並且上面有一道高亮白光（Shimmer）每秒向右刷過一次。文字使用 Monospace 字體，快速跳動分析百分比，充滿 Hacking 與 Cybernetics 的高級快感。

### State C: 魔法降臨 (Success / Delivered)
**（對比衝擊、高潮）**
渲染圖從雲端送達。
- **Before-After 震撼對比**：渲染圖出現的瞬間，原本的 SU 截圖會直接被壓低亮度與褪色 (Grayscale)。上方浮現「AI RENDERED」字樣，伴隨一陣清脆的 `#10B981` (Emerald) 綠色光效表示完成。
- **行動解鎖**：金色的 SWAP 按鈕與天藍色的 EXTRACT 按鈕帶著微小的彈性動畫 (Spring animation) 浮現，誘使用戶進入下一個工作流。

### State D: 錯誤或額度不足 (Error / Paywall)
**（優雅的警示）**
- **Paywall 模態框**：不生硬。以深邃的 `radial-gradient` 從右上角打入一束 `#F59E0B` (Amber) 的頂光。標題字呈現閃耀的金屬質感。
- **錯誤提示**：不使用刺眼的純紅。使用帶有橘紅調的 `#F43F5E`，配合細緻的抖動震動 (Shake) 動畫，讓用戶知道有狀況，但不會感到被打擾。

---

## 💻 3. Tailwind CSS 開發實戰 (Theme Extension)

若要直接在 `tailwind.config.js` (或 CDN script 中) 實作此系統，建議擴充設定：

```javascript
tailwind.config = {
  theme: {
    extend: {
      colors: {
        loam: {
          bg: '#09090b',         // 超深曜石黑
          panel: '#141417',      // 實體面板黑
          border: 'rgba(255,255,255,0.06)', // 微光邊界
          primary: '#e11d48',    // 緋紅主色
          primaryHover: '#ff2a55', // 點燃發亮紅
          magic: '#9333ea',      // AI 魔法紫
          magicHover: '#ec4899', //魔法態過渡粉
          gold: '#f59e0b',       // 商業價值金
        }
      },
      backgroundImage: {
        'glass-panel': 'linear-gradient(180deg, rgba(30, 30, 32, 0.6) 0%, rgba(20, 20, 22, 0.8) 100%)',
        'magic-flow': 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 50%, #3b82f6 100%)',
      },
      boxShadow: {
        'glow-primary': '0 0 20px -5px rgba(225, 29, 72, 0.5)',
        'glow-magic': '0 0 30px -5px rgba(139, 92, 246, 0.5)',
        'glass': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
      },
      animation: {
        'shimmer': 'shimmer 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-glow': 'pulse-glow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'shimmer': {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 15px rgba(225, 29, 72, 0.4)' },
          '50%': { opacity: '.8', boxShadow: '0 0 35px rgba(225, 29, 72, 0.8)' },
        }
      }
    }
  }
}
```

這個系統能確保整個插件散發出 Vercel / Apple 級別的前端黑科技質感，讓每一次計費與操作都變得理所當然且充滿期待。
