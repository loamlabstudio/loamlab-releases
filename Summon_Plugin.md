# 隊長召集令：主設計隊長 (Summon_Plugin.md)
**VERSION**: 1.2.0-beta-P3

## ⚠️ 緊急任務：Symlink 同步
1. 讀取 `AGENTS_CHECKLIST.md` 校對路徑。
2. 刪除 `C:\Users\qingwen\AppData\Roaming\SketchUp\SketchUp 2024\SketchUp\Plugins\loamlab_plugin`。
3. 執行管理員權限命令 (或嘗試普通權限):
   `mklink /D "C:\Users\qingwen\AppData\Roaming\SketchUp\SketchUp 2024\SketchUp\Plugins\loamlab_plugin" "C:\Users\qingwen\.gemini\antigravity\workspaces\土窟設計su渲染插件\loamlab_plugin"`
4. 在 `AGENTS_SYNC.md` 標註 `[SYMLINK_ESTABLISHED]`。

## 🎨 持續開發項目
- 統一 CSS 變數。
- 優化場景擷取時的算力消耗。
