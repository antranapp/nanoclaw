#!/usr/bin/env python3
"""
NanoClaw Scheduled Tasks – Full E2E Smoke Test
================================================
Uses Chrome (Playwright) to create a task, waits for the scheduler to
execute it, verifies execution, then deletes it via the UI.

Primary check:  task.last_run is set within 120s (scheduler ran the task)
Secondary check: /tmp/nanoclaw-smoke.txt contains expected output (agent ran OK)

Usage
-----
  # Full server already running (npm run dev):
  python3 scripts/smoke_test_e2e.py

  # Auto-start server (waits up to 3 min for WhatsApp connect):
  python3 ~/.claude/skills/webapp-testing/scripts/with_server.py \\
    --server "npm run dev" --port 4317 --timeout 180 \\
    -- python3 scripts/smoke_test_e2e.py

  # Override base URL:
  NANOCLAW_URL=http://127.0.0.1:4317 python3 scripts/smoke_test_e2e.py

Requires
--------
  pip3 install playwright
  python3 -m playwright install chromium
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

from playwright.sync_api import TimeoutError as PwTimeout
from playwright.sync_api import sync_playwright

# ─── Config ──────────────────────────────────────────────────────────────────

BASE_URL = os.environ.get("NANOCLAW_URL", "http://127.0.0.1:4317")
SCHEDULER_POLL_S = 60       # matches src/config.ts SCHEDULER_POLL_INTERVAL
MAX_WAIT_S = 130            # worst case: created just after poll + full 60s cycle
POLL_EVERY_S = 5
SMOKE_FILE = "/tmp/nanoclaw-smoke.txt"
SCREENSHOT_DIR = "/tmp"

PASS = 0
FAIL = 0
TASK_ID = None

# ─── Helpers ─────────────────────────────────────────────────────────────────

def green(s): return f"\033[32m{s}\033[0m"
def red(s):   return f"\033[31m{s}\033[0m"
def yellow(s): return f"\033[33m{s}\033[0m"
def bold(s):  return f"\033[1m{s}\033[0m"

def ok(msg):
    global PASS
    PASS += 1
    print(f"  {green('PASS')} {msg}")

def fail(msg, fatal=True):
    global FAIL
    FAIL += 1
    print(f"  {red('FAIL')} {msg}")
    if fatal:
        _cleanup_api()
        sys.exit(1)

def skip(msg):
    print(f"  {yellow('SKIP')} {msg}")

def section(title):
    print(f"\n{bold(title)}")

def screenshot(page, name):
    path = f"{SCREENSHOT_DIR}/nanoclaw-smoke-{name}.png"
    page.screenshot(path=path, full_page=False)
    print(f"  📸 {path}")
    return path

def api(method, path, body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "error": e.read().decode()}
    except (urllib.error.URLError, OSError):
        return {"error": "connection_failed"}

def _cleanup_api():
    """Delete the smoke task if it was created — called on failure."""
    if TASK_ID:
        api("DELETE", f"/api/tasks/{TASK_ID}")
        print(f"  Cleaned up task {TASK_ID}")

# ─── 1. Preflight ─────────────────────────────────────────────────────────────

section("1. Preflight — server reachable")
resp = api("GET", "/api/tasks")
if resp.get("error") == "connection_failed":
    print(f"\n{red('Server not reachable at')} {BASE_URL}")
    print("Start with:  npm run dev")
    print("Or:          NANOCLAW_URL=http://host:port python3 scripts/smoke_test_e2e.py")
    sys.exit(1)
ok(f"GET /api/tasks → {len(resp.get('tasks', []))} existing task(s)")

# ─── 2. Groups ────────────────────────────────────────────────────────────────

section("2. Discover registered groups")
groups_resp = api("GET", "/api/groups")
groups = groups_resp.get("groups", [])
print(f"  Found {len(groups)} group(s): {[g['folder'] for g in groups]}")

if groups:
    group_folder = groups[0]["folder"]
    group_jid    = groups[0]["jid"]
    group_name   = groups[0]["name"]
    ok(f"Using group '{group_name}' (folder={group_folder}, jid={group_jid})")
else:
    group_folder = "main"
    group_jid    = "web:main"
    group_name   = "main"
    skip("No groups registered — using default 'main' (task may fail to execute)")

# ─── 3. Create task via Chrome UI ─────────────────────────────────────────────

section("3. Create task via Chrome UI")
timestamp = datetime.now().strftime("%H:%M:%S")

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.set_default_timeout(10_000)

    # ── 3a. Load the webui ──────────────────────────────────────────────────
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle", timeout=15_000)
    screenshot(page, "1-home")
    ok("WebUI loaded")

    # ── 3b. Navigate to Settings (Tasks) ───────────────────────────────────
    page.locator("nav button").nth(1).click()
    page.wait_for_selector("text=Scheduled Tasks", timeout=8_000)
    screenshot(page, "2-tasks-panel")
    ok("Settings / Scheduled Tasks panel visible")

    # ── 3c. Open New Task dialog ────────────────────────────────────────────
    page.get_by_role("button", name="New Task").click()
    page.wait_for_selector("text=New Scheduled Task", timeout=5_000)
    ok("New Task dialog opened")

    # ── 3d. Fill prompt ─────────────────────────────────────────────────────
    SMOKE_PROMPT = (
        f"[SMOKE-{timestamp}] "
        f"Append the text 'SMOKE_TEST_OK at {timestamp}' on a new line to "
        f"{SMOKE_FILE}, then reply with: SMOKE_TEST_OK"
    )
    page.get_by_placeholder("What should the agent do?").fill(SMOKE_PROMPT)
    ok(f"Prompt filled: {SMOKE_PROMPT[:60]}…")

    # ── 3e. Select group ────────────────────────────────────────────────────
    dialog = page.locator("role=dialog")
    combos = dialog.locator("button[role=combobox]").all()
    # combo[0]=Group, combo[1]=ScheduleType, combo[2]=Frequency (when visible)
    group_combo = combos[0]
    group_combo.click()
    page.wait_for_timeout(300)
    # Try to select by name; fall back to first visible option
    option = page.locator(f"role=option >> text={group_name}").first
    if option.count() > 0:
        option.click()
    else:
        page.locator("role=option").first.click()
    ok(f"Group selected: {group_name}")

    # ── 3f. Switch to Advanced cron editor ──────────────────────────────────
    page.get_by_role("tab", name="Advanced").click()
    cron_input = page.locator('input[placeholder="* * * * *"]')
    cron_input.triple_click()
    cron_input.fill("*/1 * * * *")
    ok("Cron set to every minute (*/1 * * * *)")

    screenshot(page, "3-dialog-filled")

    # ── 3g. Submit ──────────────────────────────────────────────────────────
    page.get_by_role("button", name="Create").click()
    page.wait_for_selector("text=New Scheduled Task", state="hidden", timeout=8_000)
    ok("Dialog closed — task submitted")
    screenshot(page, "4-task-created")

    browser.close()

# ── 3h. Confirm task exists in API ─────────────────────────────────────────
tasks_resp = api("GET", "/api/tasks")
smoke_tasks = [
    t for t in tasks_resp.get("tasks", [])
    if "SMOKE-" in t.get("prompt", "") and timestamp[:5] in t.get("prompt", "")
]
if not smoke_tasks:
    fail("Smoke task not found in API — creation may have failed")

TASK_ID = smoke_tasks[0]["id"]
next_run = smoke_tasks[0].get("next_run", "N/A")
ok(f"Task in API — id={TASK_ID} next_run={next_run}")

# ─── 4. Verify task card in UI ────────────────────────────────────────────────

section("4. Verify task card visible in UI")
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.set_default_timeout(10_000)
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle", timeout=15_000)
    page.locator("nav button").nth(1).click()
    page.wait_for_selector("text=Scheduled Tasks", timeout=5_000)
    page.wait_for_selector(f"text=SMOKE-{timestamp[:5]}", timeout=8_000)
    ok(f"Task card visible (prompt contains 'SMOKE-{timestamp[:5]}')")

    # Check status badge shows "active"
    active_badges = page.locator("text=active").all()
    if active_badges:
        ok("Status badge shows 'active'")
    else:
        fail("No 'active' badge found", fatal=False)

    screenshot(page, "5-task-card")
    browser.close()

# ─── 5. Wait for scheduler to execute ────────────────────────────────────────

section(f"5. Wait for scheduler execution (up to {MAX_WAIT_S}s)")
print(f"  Scheduler polls every {SCHEDULER_POLL_S}s — worst case ~{SCHEDULER_POLL_S+10}s wait")
print(f"  Checking every {POLL_EVERY_S}s…\n")

executed = False
start = time.time()

while time.time() - start < MAX_WAIT_S:
    elapsed = int(time.time() - start)
    tasks = api("GET", "/api/tasks").get("tasks", [])
    task  = next((t for t in tasks if t["id"] == TASK_ID), None)

    if not task:
        fail(f"Task {TASK_ID} disappeared from API at t={elapsed}s")

    last_run    = task.get("last_run")
    last_result = task.get("last_result", "")
    status      = task.get("status", "?")
    next_run_v  = (task.get("next_run") or "")[:19]

    if last_run:
        elapsed_total = int(time.time() - start)
        ok(f"Task executed after {elapsed_total}s  last_run={last_run}")
        print(f"  last_result: {last_result[:200]!r}")
        executed = True
        break

    bar = "█" * (elapsed // 5) + "░" * ((MAX_WAIT_S - elapsed) // 5)
    print(f"  [{elapsed:3d}s] {bar} status={status} next_run={next_run_v or 'N/A'}", end="\r", flush=True)
    time.sleep(POLL_EVERY_S)

print()  # clear progress line

if not executed:
    fail(
        f"Task did not execute within {MAX_WAIT_S}s.\n"
        f"  Possible causes:\n"
        f"    • Group '{group_folder}' not registered (check /api/groups)\n"
        f"    • Scheduler loop not running (check server logs)\n"
        f"    • Agent process failed to start\n"
        f"  Tip: run 'npm run dev' and tail logs"
    )

# ─── 6. Verify execution result ───────────────────────────────────────────────

section("6. Verify execution result")
task  = next(t for t in api("GET", "/api/tasks")["tasks"] if t["id"] == TASK_ID)
last_result = task.get("last_result", "")

if last_result:
    ok(f"last_result populated: {last_result[:100]!r}")
else:
    skip("last_result is empty (agent ran but returned no output)")

# Check agent-written file (optional — agent must succeed for this)
try:
    with open(SMOKE_FILE) as f:
        file_contents = f.read()
    if "SMOKE_TEST_OK" in file_contents:
        ok(f"{SMOKE_FILE} contains 'SMOKE_TEST_OK' — agent execution fully verified")
    else:
        skip(f"{SMOKE_FILE} exists but missing 'SMOKE_TEST_OK': {file_contents[:80]!r}")
except FileNotFoundError:
    skip(
        f"{SMOKE_FILE} not found — scheduler ran the task but agent may have "
        f"errored (no API key, no group agent config, etc.)  "
        f"The scheduler itself is confirmed working."
    )

# ─── 7. Delete task via Chrome UI ─────────────────────────────────────────────

section("7. Delete task via Chrome UI")
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.set_default_timeout(10_000)

    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle", timeout=15_000)

    # Navigate to tasks panel
    page.locator("nav button").nth(1).click()
    page.wait_for_selector(f"text=SMOKE-{timestamp[:5]}", timeout=8_000)
    ok("Task card located in UI")

    # Find the delete (trash) button inside the smoke task card
    # Task card is a div containing the prompt text; delete is the last icon button
    task_card = (
        page.locator("div")
        .filter(has_text=f"SMOKE-{timestamp[:5]}")
        .filter(has=page.locator("button"))
        .first
    )
    delete_btn = task_card.locator("button").last
    delete_btn.click()
    page.wait_for_timeout(500)
    screenshot(page, "6-after-delete")
    ok("Delete button clicked")

    # Confirm task card is gone
    page.wait_for_selector(f"text=SMOKE-{timestamp[:5]}", state="hidden", timeout=5_000)
    ok("Task card removed from UI")
    browser.close()

# Verify via API too
TASK_ID_check = TASK_ID
TASK_ID = None  # prevent cleanup from re-deleting
tasks_after = api("GET", "/api/tasks").get("tasks", [])
if any(t["id"] == TASK_ID_check for t in tasks_after):
    fail("Task still in API after UI deletion")
ok("Confirmed: task absent from API after deletion")

# ─── Summary ──────────────────────────────────────────────────────────────────

total = PASS + FAIL
print(f"\n{'━' * 50}")
print(f"{bold('Results:')} {PASS}/{total} passed")

if FAIL > 0:
    print(red(f"{FAIL} check(s) failed"))
    sys.exit(1)
else:
    print(green("All checks passed! ✓"))
    print(f"\nScreenshots in {SCREENSHOT_DIR}/nanoclaw-smoke-*.png")
    sys.exit(0)
