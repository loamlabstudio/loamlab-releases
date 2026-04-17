# LoamLab AI Renderer 土窟設計 SU 渲染插件

SketchUp 插件，截取場景後透過 AI 自動生成渲染圖，並回傳至插件界面。

**當前版本：v1.4.9-beta**（以 `loamlab_plugin/config.rb` 中的 `VERSION` 為準）

---

## 快速入口

| 文件 | 用途 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | AI 操作指南（架構、部署指令、熱重載、發佈流程）|
| [TASKS.md](TASKS.md) | 任務看板（每個 session 開始前必讀）|
| [SPRINT.md](SPRINT.md) | 當前 Sprint（status: READY_FOR_CLAUDE）|
| [PRODUCT_PLAN.md](PRODUCT_PLAN.md) | 產品計畫 v2.6 |
| [ROADMAP.md](ROADMAP.md) | 全局架構與商業化躍升 Roadmap |
| [POINTS_SYSTEM.md](POINTS_SYSTEM.md) | 點數與授權體系 |

---

## 架構

```
SketchUp Plugin (Ruby + HTML/JS)
    └─► Vercel Serverless API (Node.js 18)
            ├─► AtlasCloud Nano Banana 2  (主力渲染)
            ├─► Coze Workflow             (SmartCanvas / 九宮格)
            ├─► Fal.ai                   (Inpainting)
            └─► Supabase (PostgreSQL)     (用戶、點數、歷史)
```

---

## 文件索引

```
docs/
├── api/
│   ├── ATLASCLOUD_API.md        AtlasCloud Nano Banana 2 API
│   ├── GOOGLE_AI_STUDIO_API.md  Gemini / Vertex AI 說明
│   ├── MULTI_IMAGE_WORKFLOW.md  雙圖輸入工作流模板
│   └── coze_banana2_setup.md    Coze + Banana2 串接設定
├── design/
│   └── DESIGN_SYSTEM.md         色彩與 UX 系統
├── strategy/
│   ├── FEEDBACK_SYSTEM.md       數據反饋與 AI 飛輪架構
│   ├── IG_SHARING_PLAN.md       IG 分享與社群裂變企劃
│   ├── MONITOR_COMPARE_SPEC.md  監管與對比系統規格
│   └── SMART_CANVAS_ROADMAP.md  SmartCanvas 功能路線圖
└── archive/
    ├── ROADMAP_V1.md            舊版路線圖（已由 ROADMAP.md 取代）
    └── INSTRUCTIONS_FROM_CLAUDE.md  v1.2.4-beta 時期規格筆記（編碼損毀）
```

---

## 部署快速參考

> 詳細指令見 [CLAUDE.md](CLAUDE.md)，此機器 ExecutionPolicy=Restricted，所有指令必須加 `-ExecutionPolicy Bypass`

```powershell
# 打包 .rbz
powershell -ExecutionPolicy Bypass -File ".\build_rbz.ps1"

# 部署後端
powershell -ExecutionPolicy Bypass -Command "vercel --prod"

# 熱重載（SketchUp Ruby Console）
load 'c:/Users/qingwen/.gemini/antigravity/workspaces/土窟設計su渲染插件/dev_reload.rb'
```
