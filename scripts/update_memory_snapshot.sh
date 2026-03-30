#!/usr/bin/env bash
# update_memory_snapshot.sh — 從 TASKS.md 產生記憶快照
# 由 sync_tasks.sh 在每次 commit 後非阻塞呼叫

REPO="$(git rev-parse --show-toplevel)"
TASKS="$REPO/TASKS.md"
MEMORY_DIR="C:/Users/qingwen/.claude/projects/c--Users-qingwen--gemini-antigravity-workspaces-----su----/memory"
SNAPSHOT="$MEMORY_DIR/project_progress.md"

# 提取各狀態任務
ACTIVE=$(grep -E "\[ACTIVE\]" "$TASKS" | grep -oE '\| T[0-9]+ \|[^|]+' | sed 's/| //g; s/ |/:/g' | head -5)
DONE_LIST=$(grep -E "\[DONE\]" "$TASKS" | grep -oE '\| T[0-9]+ \|' | tr -d '| ' | tr '\n' ' ')
OPEN_LIST=$(grep -E "\[OPEN\]" "$TASKS" | grep -oE '\| T[0-9]+ \|' | tr -d '| ' | tr '\n' ' ')
LAST_COMMIT=$(git -C "$REPO" log -1 --format="%s" 2>/dev/null)
NOW=$(date "+%Y-%m-%d %H:%M")

# 若 ACTIVE 為空
[ -z "$ACTIVE" ] && ACTIVE="（無）"
[ -z "$DONE_LIST" ] && DONE_LIST="（無）"
[ -z "$OPEN_LIST" ] && OPEN_LIST="（無）"

cat > "$SNAPSHOT" << EOF
---
name: project_progress
description: TASKS.md 自動快照（每次 commit 後更新），顯示各任務最新狀態，供所有 session 快速掌握整體進度
type: project
---

> 最後更新：$NOW（由 scripts/update_memory_snapshot.sh 自動產生，勿手動編輯）
> 最新 commit：$LAST_COMMIT

## 進行中 [ACTIVE]
$ACTIVE

## 待認領 [OPEN]
$OPEN_LIST

## 已完成 [DONE]
$DONE_LIST

---

**How to apply**：開 session 時若 TASKS.md 尚未讀取，可先參考此快照判斷哪些任務可認領、哪些已有 session 在做。正式操作前仍需讀 TASKS.md 確認最新狀態。
EOF

echo "[update_memory_snapshot] 快照已更新 → $SNAPSHOT"
