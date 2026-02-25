/**
 * Stdio MCP Server for NanoClaw
 * Standalone process that agent teams subagents can inherit.
 * Reads context from environment variables, writes IPC files for the host.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';

const IPC_DIR = process.env.NANOCLAW_IPC_DIR || '/tmp/nanoclaw-ipc';
const MESSAGES_DIR = path.join(IPC_DIR, 'messages');
const TASKS_DIR = path.join(IPC_DIR, 'tasks');

// Context from environment variables (set by the agent runner)
const chatJid = process.env.NANOCLAW_CHAT_JID!;
const groupFolder = process.env.NANOCLAW_GROUP_FOLDER!;
const isMain = process.env.NANOCLAW_IS_MAIN === '1';
const TIMEZONE = process.env.NANOCLAW_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Current local time formatted as "YYYY-MM-DDTHH:MM:SS" in TIMEZONE. */
function currentLocalTime(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date()).replace(', ', 'T').replace(/24:/, '00:');
}

/**
 * Parse a relative time string like "+5m", "+1h30m", "+90s" into milliseconds.
 * Returns null if the string is not a relative format.
 */
function parseRelativeTime(value: string): number | null {
  if (!value.startsWith('+')) return null;
  const str = value.slice(1);
  let totalMs = 0;
  let matched = false;

  const dayMatch = str.match(/(\d+)\s*d/);
  if (dayMatch) { totalMs += parseInt(dayMatch[1], 10) * 86_400_000; matched = true; }

  const hourMatch = str.match(/(\d+)\s*h/);
  if (hourMatch) { totalMs += parseInt(hourMatch[1], 10) * 3_600_000; matched = true; }

  const minMatch = str.match(/(\d+)\s*m(?!s)/);
  if (minMatch) { totalMs += parseInt(minMatch[1], 10) * 60_000; matched = true; }

  const secMatch = str.match(/(\d+)\s*s/);
  if (secMatch) { totalMs += parseInt(secMatch[1], 10) * 1_000; matched = true; }

  return matched && totalMs > 0 ? totalMs : null;
}

/**
 * Convert a local datetime string (no timezone) to UTC ISO string.
 * Uses Intl to compute the timezone offset — no external dependencies.
 */
function localToUtcIso(localStr: string, timezone: string): string {
  const m = localStr.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) throw new Error(`Invalid local datetime: ${localStr}`);
  const [, year, month, day, hour, minute, second = '0'] = m;

  // Treat the components as UTC to get a reference point
  const naiveUtcMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);

  // Format that UTC instant in the target timezone
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const get = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  const h = get('hour') % 24;
  const tzViewMs = Date.UTC(get('year'), get('month') - 1, get('day'), h, get('minute'), get('second'));

  // offset = how far the timezone is from UTC at this instant
  const offsetMs = tzViewMs - naiveUtcMs;
  return new Date(naiveUtcMs - offsetMs).toISOString();
}

/** Format a Date as a full local datetime string in TIMEZONE. */
function formatLocalDateTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

/**
 * Resolve a "once" schedule_value to a UTC ISO string.
 * Accepts: "+5m" (relative), "2026-02-25T07:16:00" (local), or UTC ISO string.
 */
function resolveOnceValue(value: string): { utcIso: string; localDisplay: string } | { error: string } {
  // Relative time: "+5m", "+1h30m", etc.
  const relMs = parseRelativeTime(value);
  if (relMs !== null) {
    const target = new Date(Date.now() + relMs);
    return { utcIso: target.toISOString(), localDisplay: formatLocalDateTime(target) };
  }

  // Already UTC (has Z or offset suffix)
  if (/[Zz]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value)) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return { error: `Invalid timestamp: "${value}"` };
    return { utcIso: d.toISOString(), localDisplay: formatLocalDateTime(d) };
  }

  // Local time string — convert to UTC
  try {
    const utcIso = localToUtcIso(value, TIMEZONE);
    return { utcIso, localDisplay: value };
  } catch {
    return { error: `Invalid timestamp: "${value}". Use format like "2026-02-01T15:30:00" or relative like "+5m".` };
  }
}

function writeIpcFile(dir: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);

  // Atomic write: temp file then rename
  const tempPath = `${filepath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filepath);

  return filename;
}

const server = new McpServer({
  name: 'nanoclaw',
  version: '1.0.0',
});

server.tool(
  'send_message',
  "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  {
    text: z.string().describe('The message text to send'),
    sender: z.string().optional().describe('Your role/identity name (e.g. "Researcher"). When set, messages appear from a dedicated bot in Telegram.'),
  },
  async (args) => {
    const data: Record<string, string | undefined> = {
      type: 'message',
      chatJid,
      text: args.text,
      sender: args.sender || undefined,
      groupFolder,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(MESSAGES_DIR, data);

    return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
  },
);

server.tool(
  'schedule_task',
  `Schedule a recurring or one-time task. The task will run as a full agent with access to all tools.

CURRENT TIME: ${currentLocalTime()} (timezone: ${TIMEZONE})

CONTEXT MODE - Choose based on task type:
\u2022 "group": Task runs in the group's conversation context, with access to chat history. Use for tasks that need context about ongoing discussions, user preferences, or recent interactions.
\u2022 "isolated": Task runs in a fresh session with no conversation history. Use for independent tasks that don't need prior context. When using isolated mode, include all necessary context in the prompt itself.

If unsure which mode to use, you can ask the user. Examples:
- "Remind me about our discussion" \u2192 group (needs conversation context)
- "Check the weather every morning" \u2192 isolated (self-contained task)
- "Follow up on my request" \u2192 group (needs to know what was requested)
- "Generate a daily report" \u2192 isolated (just needs instructions in prompt)

MESSAGING BEHAVIOR - The task agent's output is sent to the user or group. It can also use send_message for immediate delivery, or wrap output in <internal> tags to suppress it. Include guidance in the prompt about whether the agent should:
\u2022 Always send a message (e.g., reminders, daily briefings)
\u2022 Only send a message when there's something to report (e.g., "notify me if...")
\u2022 Never send a message (background maintenance tasks)

SCHEDULE VALUE FORMAT:
\u2022 cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am in ${TIMEZONE})
\u2022 interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
\u2022 once: PREFERRED: relative offset like "+5m", "+1h", "+1h30m", "+2d". The server computes the exact time.
         Also accepted: local timestamp like "2026-02-01T15:30:00" (in ${TIMEZONE}, no Z suffix).

IMPORTANT for "once" tasks: When the user says "in X minutes/hours", ALWAYS use relative format "+Xm" or "+Xh". Do NOT compute the absolute time yourself — let the server handle it.`,
  {
    prompt: z.string().describe('What the agent should do when the task runs. For isolated mode, include all necessary context here.'),
    schedule_type: z.enum(['cron', 'interval', 'once']).describe('cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time'),
    schedule_value: z.string().describe('cron: "*/5 * * * *" | interval: "300000" | once: "+5m" or "+1h" (preferred) or local time "2026-02-01T15:30:00"'),
    context_mode: z.enum(['group', 'isolated']).default('group').describe('group=runs with chat history and memory, isolated=fresh session (include context in prompt)'),
    target_group_jid: z.string().optional().describe('(Main group only) JID of the group to schedule the task for. Defaults to the current group.'),
  },
  async (args) => {
    // Validate schedule_value before writing IPC
    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value);
      } catch {
        return {
          content: [{ type: 'text' as const, text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [{ type: 'text' as const, text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).` }],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      const resolved = resolveOnceValue(args.schedule_value);
      if ('error' in resolved) {
        return {
          content: [{ type: 'text' as const, text: resolved.error }],
          isError: true,
        };
      }
    }

    // Non-main groups can only schedule for themselves
    const targetJid = isMain && args.target_group_jid ? args.target_group_jid : chatJid;

    // For "once" tasks, resolve to UTC ISO string server-side
    let scheduleValue = args.schedule_value;
    let resolvedLocalDisplay: string | undefined;
    if (args.schedule_type === 'once') {
      const resolved = resolveOnceValue(args.schedule_value);
      if ('error' in resolved) {
        return {
          content: [{ type: 'text' as const, text: resolved.error }],
          isError: true,
        };
      }
      scheduleValue = resolved.utcIso;
      resolvedLocalDisplay = resolved.localDisplay;
    }

    const data = {
      type: 'schedule_task',
      prompt: args.prompt,
      schedule_type: args.schedule_type,
      schedule_value: scheduleValue,
      context_mode: args.context_mode || 'group',
      timezone: TIMEZONE,
      targetJid,
      createdBy: groupFolder,
      timestamp: new Date().toISOString(),
    };

    const filename = writeIpcFile(TASKS_DIR, data);

    if (resolvedLocalDisplay) {
      return {
        content: [{ type: 'text' as const, text: `Task scheduled successfully. It will run at ${resolvedLocalDisplay} (${TIMEZONE}). Use this exact time when telling the user.` }],
      };
    }
    return {
      content: [{ type: 'text' as const, text: `Task scheduled (${filename}): ${args.schedule_type} - ${args.schedule_value}` }],
    };
  },
);

server.tool(
  'list_tasks',
  "List all scheduled tasks. From main: shows all tasks. From other groups: shows only that group's tasks.",
  {},
  async () => {
    const tasksFile = path.join(IPC_DIR, 'current_tasks.json');

    try {
      if (!fs.existsSync(tasksFile)) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const allTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));

      const tasks = isMain
        ? allTasks
        : allTasks.filter((t: { groupFolder: string }) => t.groupFolder === groupFolder);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] };
      }

      const formatted = tasks
        .map(
          (t: { id: string; prompt: string; schedule_type: string; schedule_value: string; status: string; next_run: string }) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');

      return { content: [{ type: 'text' as const, text: `Scheduled tasks:\n${formatted}` }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Error reading tasks: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  },
);

server.tool(
  'pause_task',
  'Pause a scheduled task. It will not run until resumed.',
  { task_id: z.string().describe('The task ID to pause') },
  async (args) => {
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} pause requested.` }] };
  },
);

server.tool(
  'resume_task',
  'Resume a paused task.',
  { task_id: z.string().describe('The task ID to resume') },
  async (args) => {
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resume requested.` }] };
  },
);

server.tool(
  'cancel_task',
  'Cancel and delete a scheduled task.',
  { task_id: z.string().describe('The task ID to cancel') },
  async (args) => {
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder,
      isMain,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancellation requested.` }] };
  },
);

server.tool(
  'register_group',
  `Register a new WhatsApp group so the agent can respond to messages there. Main group only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").`,
  {
    jid: z.string().describe('The WhatsApp JID (e.g., "120363336345536173@g.us")'),
    name: z.string().describe('Display name for the group'),
    folder: z.string().describe('Folder name for group files (lowercase, hyphens, e.g., "family-chat")'),
    trigger: z.string().describe('Trigger word (e.g., "@Andy")'),
  },
  async (args) => {
    if (!isMain) {
      return {
        content: [{ type: 'text' as const, text: 'Only the main group can register new groups.' }],
        isError: true,
      };
    }

    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      trigger: args.trigger,
      timestamp: new Date().toISOString(),
    };

    writeIpcFile(TASKS_DIR, data);

    return {
      content: [{ type: 'text' as const, text: `Group "${args.name}" registered. It will start receiving messages immediately.` }],
    };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
