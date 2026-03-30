#!/usr/bin/env bash
# sync_tasks.sh — git post-commit 後自動同步 TASKS.md 進度
# 約定：commit message 加 [T\d+] 標記任務 ID，加 [DONE] 標記完成
# 範例：feat(ui): 完成 Rating Bar [T07][DONE]

REPO="$(git rev-parse --show-toplevel)"
TASKS="$REPO/TASKS.md"
LOCK="/tmp/sync_tasks_loamlab.lock"
MEMORY_SCRIPT="$REPO/scripts/update_memory_snapshot.sh"

# ── 1. 讀最新 commit message
COMMIT_MSG=$(git -C "$REPO" log -1 --format="%s %b" 2>/dev/null)

# ── 2. 提取任務 ID（支援多個，取第一個）
TASK_ID=$(echo "$COMMIT_MSG" | grep -oE '\[T[0-9]+\]' | head -1 | tr -d '[]')
if [ -z "$TASK_ID" ]; then
  exit 0  # 無任務標籤，靜默退出
fi

# ── 3. 判斷是否標記 DONE
IS_DONE=0
echo "$COMMIT_MSG" | grep -qE '\[DONE\]' && IS_DONE=1

# ── 4. 檔案鎖（防多視窗並發寫入損壞）
exec 9>"$LOCK"
flock -x -w 5 9 || { echo "[sync_tasks] 等待鎖逾時，跳過"; exit 0; }

# ── 5. 更新 TASKS.md 狀態
if [ "$IS_DONE" -eq 1 ]; then
  # [DONE]：將 OPEN/ACTIVE → DONE
  sed -i "s/| \`\[OPEN\]\` |/| \`[DONE]\` |/;/| $TASK_ID |/s/\[OPEN\]/[DONE]/;/| $TASK_ID |/s/\[ACTIVE\]/[DONE]/" "$TASKS"
  sed -i "/| $TASK_ID |/s/\[OPEN\]/[DONE]/" "$TASKS"
  sed -i "/| $TASK_ID |/s/\[ACTIVE\]/[DONE]/" "$TASKS"
  STATUS_LABEL="DONE"
else
  # 無 [DONE]：將 OPEN → ACTIVE（認領任務）
  sed -i "/| $TASK_ID |/s/\[OPEN\]/[ACTIVE]/" "$TASKS"
  STATUS_LABEL="ACTIVE"
fi

# ── 6. 若 DONE，向整合佇列 append（避免重複）
if [ "$IS_DONE" -eq 1 ]; then
  BRANCH=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)
  DATE=$(date +%Y-%m-%d)
  ENTRY="- [x] $TASK_ID — 自動同步（$BRANCH）— ✅ commit 於 $DATE"

  # 只在佇列區塊中沒有此 Task ID 時才加入
  if ! grep -A 50 "^## 整合佇列" "$TASKS" | grep -q "$TASK_ID"; then
    # 在整合佇列第一個 "- [x]" 之前插入（或直接 append 到佇列區塊末）
    sed -i "/^## 整合佇列/,/^---/{/^---/i\\$ENTRY
    }" "$TASKS" 2>/dev/null || true
  fi
fi

# ── 7. 釋放鎖
flock -u 9

echo "[sync_tasks] $TASK_ID → $STATUS_LABEL"

# ── 8. 更新記憶快照（非阻塞）
if [ -f "$MEMORY_SCRIPT" ]; then
  bash "$MEMORY_SCRIPT" &
fi
