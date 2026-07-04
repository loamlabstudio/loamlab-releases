#!/bin/bash
# Commit 後自動部署安全閘門。
#
# 這支腳本是 .claude/settings.local.json 的 PostToolUse hook 實際呼叫的目標，
# 修改前請先讀 CLAUDE.md「Commit 觸發的後端自動部署」章節了解完整流程。
#
# 目標：commit 到 main 就自動把後端部署上線，但絕不能讓開發中/未完成的功能
# （FEATURE_FLAGS.md 標記 wip 的 BLOCKED_FILES）跟著溜上正式環境。
#
# 刻意不動 .rbz 打包/發佈 —— 那是要動版本號、寫 changelog 的正式「發佈更新」
# 三步驟流程，不該被每一次 commit 都自動觸發，維持手動確認。
cd "$(dirname "$0")/.." || exit 0
LOG="auto_deploy.log"
ts() { date '+%Y-%m-%d %H:%M:%S'; }

branch=$(git branch --show-current 2>/dev/null)
if [ "$branch" != "main" ]; then
    echo "$(ts) [SKIP] 目前分支=$branch，非 main 不自動部署" >> "$LOG"
    exit 0
fi

if ! powershell -ExecutionPolicy Bypass -File "./scripts/pre_release_check.ps1" >> "$LOG" 2>&1; then
    echo "$(ts) [BLOCKED] Release Gate 未通過（WIP 外洩 / 版本不同步等），已中止自動部署，詳見上方輸出" >> "$LOG"
    exit 0
fi

echo "$(ts) [DEPLOY] Gate 通過，開始部署後端..." >> "$LOG"
# 必須在專案根目錄執行，不要 cd 進 loamlab_backend —— Vercel 專案設定本身
# Root Directory 已指向 loamlab_backend，從該目錄內再執行會疊加成不存在的路徑
if powershell -ExecutionPolicy Bypass -Command "vercel --prod" >> "$LOG" 2>&1; then
    echo "$(ts) [DONE] 後端部署完成" >> "$LOG"
else
    echo "$(ts) [ERROR] vercel --prod 失敗，請查看上方輸出" >> "$LOG"
fi
