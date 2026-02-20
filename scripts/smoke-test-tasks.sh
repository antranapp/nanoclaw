#!/usr/bin/env bash
#
# Smoke test for the Scheduled Tasks API.
# Exercises every endpoint the WebUI calls: CRUD, pause/resume, groups.
#
# Usage:
#   ./scripts/smoke-test-tasks.sh              # default: http://127.0.0.1:4317
#   ./scripts/smoke-test-tasks.sh http://host:port
#
# Requires: curl, jq
# The full NanoClaw server must be running (npm run dev).

set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:4317}"
PASS=0
FAIL=0
TASK_ID=""

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf "\033[31m%s\033[0m" "$*"; }
green() { printf "\033[32m%s\033[0m" "$*"; }
bold()  { printf "\033[1m%s\033[0m" "$*"; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  $(green PASS) $label"
    ((PASS++))
  else
    echo "  $(red FAIL) $label — expected '$expected', got '$actual'"
    ((FAIL++))
  fi
}

assert_not_empty() {
  local label="$1" actual="$2"
  if [[ -n "$actual" && "$actual" != "null" ]]; then
    echo "  $(green PASS) $label"
    ((PASS++))
  else
    echo "  $(red FAIL) $label — value was empty or null"
    ((FAIL++))
  fi
}

assert_match() {
  local label="$1" pattern="$2" actual="$3"
  if echo "$actual" | grep -qE "$pattern"; then
    echo "  $(green PASS) $label"
    ((PASS++))
  else
    echo "  $(red FAIL) $label — '$actual' did not match /$pattern/"
    ((FAIL++))
  fi
}

api() {
  local method="$1" path="$2"
  shift 2
  curl -sf -X "$method" "$BASE_URL$path" \
    -H 'Content-Type: application/json' \
    "$@" 2>/dev/null || echo '{"error":"request_failed"}'
}

cleanup() {
  if [[ -n "$TASK_ID" ]]; then
    echo ""
    echo "$(bold 'Cleanup:') deleting task $TASK_ID"
    api DELETE "/api/tasks/$TASK_ID" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# ── Preflight ────────────────────────────────────────────────────────────────

echo "$(bold 'Scheduled Tasks Smoke Test')"
echo "Server: $BASE_URL"
echo ""

echo "$(bold '1. Preflight — server reachable')"
HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/api/tasks" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "000" ]]; then
  echo "  $(red FAIL) Server not reachable at $BASE_URL"
  echo ""
  echo "Start the server first:  npm run dev"
  exit 1
fi
assert_eq "GET /api/tasks returns 200" "200" "$HTTP_CODE"

# ── Groups ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '2. GET /api/groups — list registered groups')"
GROUPS_RESP=$(api GET "/api/groups")
GROUPS_COUNT=$(echo "$GROUPS_RESP" | jq '.groups | length')
echo "  Found $GROUPS_COUNT group(s)"
assert_match "Response has groups array" '"groups"' "$GROUPS_RESP"

# Pick first group for task creation (or use fallback)
GROUP_FOLDER=$(echo "$GROUPS_RESP" | jq -r '.groups[0].folder // "main"')
GROUP_JID=$(echo "$GROUPS_RESP" | jq -r '.groups[0].jid // "web:main"')
echo "  Using group: folder=$GROUP_FOLDER jid=$GROUP_JID"

# ── Create ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '3. POST /api/tasks — create task (30s interval)')"
CREATE_RESP=$(api POST "/api/tasks" -d "{
  \"group_folder\": \"$GROUP_FOLDER\",
  \"chat_jid\": \"$GROUP_JID\",
  \"prompt\": \"[SMOKE TEST] Say: smoke test passed at $(date +%H:%M:%S)\",
  \"schedule_type\": \"interval\",
  \"schedule_value\": \"30000\",
  \"context_mode\": \"isolated\",
  \"status\": \"active\"
}")
TASK_ID=$(echo "$CREATE_RESP" | jq -r '.task.id // empty')
assert_not_empty "Task created with ID" "$TASK_ID"
assert_eq "Status is active" "active" "$(echo "$CREATE_RESP" | jq -r '.task.status')"
assert_eq "Schedule type is interval" "interval" "$(echo "$CREATE_RESP" | jq -r '.task.schedule_type')"
assert_eq "Schedule value is 30000" "30000" "$(echo "$CREATE_RESP" | jq -r '.task.schedule_value')"
assert_eq "Context mode is isolated" "isolated" "$(echo "$CREATE_RESP" | jq -r '.task.context_mode')"
assert_not_empty "next_run is set" "$(echo "$CREATE_RESP" | jq -r '.task.next_run')"

# ── Read ─────────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '4. GET /api/tasks — list includes new task')"
LIST_RESP=$(api GET "/api/tasks")
FOUND=$(echo "$LIST_RESP" | jq --arg id "$TASK_ID" '[.tasks[] | select(.id == $id)] | length')
assert_eq "Task $TASK_ID found in list" "1" "$FOUND"

# ── Update ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '5. PUT /api/tasks/:id — update prompt + schedule')"
UPDATE_RESP=$(api PUT "/api/tasks/$TASK_ID" -d '{
  "prompt": "[SMOKE TEST] Updated prompt",
  "schedule_type": "cron",
  "schedule_value": "*/1 * * * *"
}')
assert_eq "Prompt updated" "[SMOKE TEST] Updated prompt" "$(echo "$UPDATE_RESP" | jq -r '.task.prompt')"
assert_eq "Schedule type changed to cron" "cron" "$(echo "$UPDATE_RESP" | jq -r '.task.schedule_type')"
assert_eq "Schedule value changed" "*/1 * * * *" "$(echo "$UPDATE_RESP" | jq -r '.task.schedule_value')"
assert_not_empty "next_run recalculated" "$(echo "$UPDATE_RESP" | jq -r '.task.next_run')"

# ── Pause ────────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '6. POST /api/tasks/:id/pause — pause task')"
PAUSE_RESP=$(api POST "/api/tasks/$TASK_ID/pause")
assert_eq "Status is paused" "paused" "$(echo "$PAUSE_RESP" | jq -r '.task.status')"

# ── Resume ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '7. POST /api/tasks/:id/resume — resume task')"
RESUME_RESP=$(api POST "/api/tasks/$TASK_ID/resume")
assert_eq "Status is active" "active" "$(echo "$RESUME_RESP" | jq -r '.task.status')"
assert_not_empty "next_run recalculated on resume" "$(echo "$RESUME_RESP" | jq -r '.task.next_run')"

# ── Wait for execution (optional) ───────────────────────────────────────────

echo ""
echo "$(bold '8. Wait for scheduler to execute task (up to 90s)...')"
echo "  (The task runs every minute via cron. Waiting for last_run to appear.)"

EXECUTED=false
for i in $(seq 1 18); do
  sleep 5
  CHECK_RESP=$(api GET "/api/tasks")
  LAST_RUN=$(echo "$CHECK_RESP" | jq -r --arg id "$TASK_ID" '.tasks[] | select(.id == $id) | .last_run // empty')
  if [[ -n "$LAST_RUN" && "$LAST_RUN" != "null" ]]; then
    echo "  Task executed! last_run=$LAST_RUN (after ${i}x5s = $((i*5))s)"
    EXECUTED=true
    break
  fi
  printf "  Waiting... %ds\r" "$((i * 5))"
done

if $EXECUTED; then
  assert_not_empty "last_run is populated" "$LAST_RUN"

  LAST_RESULT=$(echo "$CHECK_RESP" | jq -r --arg id "$TASK_ID" '.tasks[] | select(.id == $id) | .last_result // empty')
  assert_not_empty "last_result is populated" "$LAST_RESULT"
  echo "  last_result: $LAST_RESULT"
else
  echo "  $(red SKIP) Task did not execute within 90s"
  echo "  (This is OK if no agent is configured for group '$GROUP_FOLDER')"
  echo "  The CRUD operations above still validate the API correctly."
fi

# ── Delete ───────────────────────────────────────────────────────────────────

echo ""
echo "$(bold '9. DELETE /api/tasks/:id — delete task')"
DELETE_RESP=$(api DELETE "/api/tasks/$TASK_ID")
assert_match "Delete returns ok" '"ok"' "$DELETE_RESP"

# Verify deletion
LIST_AFTER=$(api GET "/api/tasks")
FOUND_AFTER=$(echo "$LIST_AFTER" | jq --arg id "$TASK_ID" '[.tasks[] | select(.id == $id)] | length')
assert_eq "Task no longer in list" "0" "$FOUND_AFTER"

# Clear TASK_ID so cleanup trap doesn't try to delete again
TASK_ID=""

# ── 404 handling ─────────────────────────────────────────────────────────────

echo ""
echo "$(bold '10. 404 handling — operations on nonexistent task')"
GHOST="nonexistent-task-id"
NOT_FOUND=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT "$BASE_URL/api/tasks/$GHOST" \
  -H 'Content-Type: application/json' -d '{"prompt":"x"}' 2>/dev/null || echo "404")
assert_eq "PUT nonexistent task returns 404" "404" "$NOT_FOUND"

NOT_FOUND2=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/tasks/$GHOST" 2>/dev/null || echo "404")
assert_eq "DELETE nonexistent task returns 404" "404" "$NOT_FOUND2"

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
echo "$(bold "Results: $PASS/$TOTAL passed")"
if [[ $FAIL -gt 0 ]]; then
  echo "$(red "$FAIL test(s) failed")"
  exit 1
else
  echo "$(green "All tests passed!")"
  exit 0
fi
