---
name: debug
description: Debug agent issues. Use when things aren't working, agent fails, authentication problems, or to understand how the agent system works. Covers logs, environment variables, and common issues.
---

# NanoClaw Agent Debugging

This guide covers debugging the direct-process agent execution system.

## Architecture Overview

```
Host (macOS / Linux)
─────────────────────────────────────
src/process-runner.ts                 agent-runner/src/index.ts
    │                                      │
    │ spawns Node.js child process         │ runs Claude Agent SDK
    │ with env vars for paths              │ with MCP servers
    │                                      │
    │  Env: NANOCLAW_IPC_DIR ──────> data/ipc/{folder}
    │  Env: NANOCLAW_GROUP_DIR ────> groups/{folder}
    │  Env: NANOCLAW_GLOBAL_DIR ───> groups/global
    │  Env: NANOCLAW_EXTRA_DIRS ───> additional directories
    │  Env: CLAUDE_HOME ──────────> data/sessions/{folder}
    └──────────────────────────────────────────────────
```

## Log Locations

| Log | Location | Content |
|-----|----------|---------|
| **Main app logs** | `logs/nanoclaw.log` | Host-side WhatsApp, routing, agent spawning |
| **Main app errors** | `logs/nanoclaw.error.log` | Host-side errors |
| **Agent run logs** | `groups/{folder}/logs/agent-*.log` | Per-run: input, env, stderr, stdout |
| **Claude sessions** | `data/sessions/{folder}/.claude/` | Claude Code session history (per-group) |

## Enabling Debug Logging

Set `LOG_LEVEL=debug` for verbose output:

```bash
# For development
LOG_LEVEL=debug npm run dev

# For launchd service, add to plist EnvironmentVariables:
<key>LOG_LEVEL</key>
<string>debug</string>
```

Debug level shows:
- Environment variables passed to agent
- Real-time agent stderr
- IPC file processing

## Common Issues

### 1. "Claude Code process exited with code 1"

**Check the agent log file** in `groups/{folder}/logs/agent-*.log`

Common causes:

#### Missing Authentication
```
Invalid API key · Please run /login
```
**Fix:** Ensure `.env` file exists with either OAuth token or API key:
```bash
cat .env  # Should show one of:
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...  (subscription)
# ANTHROPIC_API_KEY=sk-ant-api03-...        (pay-per-use)
```

#### Missing agent-runner build
```
Cannot find module 'agent-runner/dist/index.js'
```
**Fix:** Build the agent-runner:
```bash
cd agent-runner && npm install && npm run build && cd ..
```

### 2. Session Not Resuming

If sessions aren't being resumed (new session ID every time):

**Root cause:** The SDK looks for sessions relative to `CLAUDE_HOME`. Each group gets `data/sessions/{groupFolder}` as its `CLAUDE_HOME`.

**Check session directories exist:**
```bash
ls -la data/sessions/
ls -la data/sessions/main/.claude/
```

**Verify session resumption is working** — check logs for the same session ID across messages:
```bash
grep "Session initialized" logs/nanoclaw.log | tail -5
# Should show the SAME session ID for consecutive messages in the same group
```

### 3. MCP Server Failures

If an MCP server fails to start, the agent may exit. Check the agent logs for MCP initialization errors:
```bash
ls -t groups/*/logs/agent-*.log | head -1 | xargs tail -50
```

### 4. Agent Timeout

The agent has a configurable timeout (default in `src/config.ts`). If the agent takes too long:
- First SIGTERM is sent (graceful shutdown)
- After 10 seconds, SIGKILL forces termination
- Check `logs/nanoclaw.log` for timeout messages

### 5. IPC Not Working

The agent communicates back to the host via files in `data/ipc/{groupFolder}/`:

```bash
# Check pending messages
ls -la data/ipc/*/messages/

# Check pending task operations
ls -la data/ipc/*/tasks/

# Check for IPC errors
ls -la data/ipc/errors/

# Check available groups (main channel only)
cat data/ipc/main/available_groups.json

# Check current tasks snapshot
cat data/ipc/{groupFolder}/current_tasks.json
```

**IPC file types:**
- `messages/*.json` - Agent writes: outgoing WhatsApp messages
- `tasks/*.json` - Agent writes: task operations (schedule, pause, resume, cancel, refresh_groups)
- `current_tasks.json` - Host writes: read-only snapshot of scheduled tasks
- `available_groups.json` - Host writes: read-only list of WhatsApp groups (main only)

## Manual Agent Testing

### Test the full agent flow:
```bash
echo '{"prompt":"What is 2+2?","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  NANOCLAW_IPC_DIR=$(pwd)/data/ipc/test \
  NANOCLAW_GROUP_DIR=$(pwd)/groups/test \
  NANOCLAW_GLOBAL_DIR=$(pwd)/groups/global \
  CLAUDE_HOME=$(pwd)/data/sessions/test \
  node agent-runner/dist/index.js
```

### Test with environment from .env:
```bash
export $(grep -v '^#' .env | xargs)
echo '{"prompt":"Say hello","groupFolder":"test","chatJid":"test@g.us","isMain":false}' | \
  NANOCLAW_IPC_DIR=$(pwd)/data/ipc/test \
  NANOCLAW_GROUP_DIR=$(pwd)/groups/test \
  NANOCLAW_GLOBAL_DIR=$(pwd)/groups/global \
  CLAUDE_HOME=$(pwd)/data/sessions/test \
  node agent-runner/dist/index.js
```

## SDK Options Reference

The agent-runner uses these Claude Agent SDK options:

```typescript
query({
  prompt: input.prompt,
  options: {
    cwd: process.env.NANOCLAW_GROUP_DIR,
    allowedTools: ['Bash', 'Read', 'Write', ...],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    settingSources: ['project'],
    mcpServers: { ... }
  }
})
```

**Important:** `allowDangerouslySkipPermissions: true` is required when using `permissionMode: 'bypassPermissions'`. Without it, Claude Code exits with code 1.

## Rebuilding After Changes

```bash
# Rebuild main app
npm run build

# Rebuild agent-runner only
cd agent-runner && npm run build && cd ..

# Rebuild everything
npm run build  # builds main + agent-runner
```

## Session Persistence

Claude sessions are stored per-group in `data/sessions/{group}/.claude/` for security isolation. Each group has its own session directory, preventing cross-group access to conversation history.

To clear sessions:

```bash
# Clear all sessions for all groups
rm -rf data/sessions/

# Clear sessions for a specific group
rm -rf data/sessions/{groupFolder}/.claude/

# Also clear the session ID from NanoClaw's tracking (stored in SQLite)
sqlite3 store/messages.db "DELETE FROM sessions WHERE group_folder = '{groupFolder}'"
```

## Quick Diagnostic Script

Run this to check common issues:

```bash
echo "=== Checking NanoClaw Setup ==="

echo -e "\n1. Authentication configured?"
[ -f .env ] && (grep -q "CLAUDE_CODE_OAUTH_TOKEN=sk-" .env || grep -q "ANTHROPIC_API_KEY=sk-" .env) && echo "OK" || echo "MISSING - add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to .env"

echo -e "\n2. Node.js available?"
node --version 2>/dev/null && echo "OK" || echo "MISSING - install Node.js 20+"

echo -e "\n3. Agent-runner built?"
[ -f agent-runner/dist/index.js ] && echo "OK" || echo "MISSING - run: cd agent-runner && npm install && npm run build"

echo -e "\n4. Dependencies installed?"
[ -d node_modules ] && echo "OK" || echo "MISSING - run: npm install"

echo -e "\n5. Groups directory?"
ls -la groups/ 2>/dev/null || echo "MISSING - run setup"

echo -e "\n6. Recent agent logs?"
ls -t groups/*/logs/agent-*.log 2>/dev/null | head -3 || echo "No agent logs yet"

echo -e "\n7. Session continuity working?"
SESSIONS=$(grep "Session initialized" logs/nanoclaw.log 2>/dev/null | tail -5 | awk '{print $NF}' | sort -u | wc -l)
[ "$SESSIONS" -le 2 ] && echo "OK (recent sessions reusing IDs)" || echo "CHECK - multiple different session IDs, may indicate resumption issues"

echo -e "\n8. Service running?"
launchctl list 2>/dev/null | grep -q "com.nanoclaw" && echo "OK" || echo "NOT RUNNING - check: launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist"
```
