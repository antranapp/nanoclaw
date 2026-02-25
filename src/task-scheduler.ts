import { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { CronExpressionParser } from 'cron-parser';
import fs from 'fs';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  SCHEDULER_POLL_INTERVAL,
  TIMEZONE,
} from './config.js';
import {
  AgentOutput,
  runAgent as runProcessAgent,
  writeTasksSnapshot,
} from './process-runner.js';
import {
  getAllTasks,
  getDueTasks,
  getTaskById,
  logTaskRun,
  markTaskRunFinished,
  markTaskRunStarted,
  pruneTaskRunEvents,
  updateTask,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { logger } from './logger.js';
import { taskEventBus } from './task-events.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

export interface SchedulerDependencies {
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  queue: GroupQueue;
  onProcess: (
    groupKey: string,
    proc: ChildProcess,
    processName: string,
    groupFolder: string,
    activeChatJid: string,
  ) => void;
  sendMessage: (jid: string, text: string) => Promise<void>;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatLocalTime(isoString: string, timezone?: string): string {
  try {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone || TIMEZONE,
    });
  } catch {
    return isoString;
  }
}

async function runTask(
  task: ScheduledTask,
  deps: SchedulerDependencies,
): Promise<void> {
  const startTime = Date.now();
  const runId = randomUUID();
  const shortId = task.id.slice(0, 8);

  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(task.group_folder);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Stop retry churn for malformed legacy rows.
    updateTask(task.id, { status: 'paused' });
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder, error },
      'Task has invalid group folder',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error,
    });
    return;
  }
  fs.mkdirSync(groupDir, { recursive: true });

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(
    (g) => g.folder === task.group_folder,
  );

  if (!group) {
    logger.error(
      { taskId: task.id, groupFolder: task.group_folder },
      'Group not found for task',
    );
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`,
    });
    return;
  }

  // --- On start ---
  const startedAt = new Date().toISOString();
  markTaskRunStarted(task.id, runId, startedAt);

  const updatedTaskAtStart = getTaskById(task.id);
  if (updatedTaskAtStart) {
    taskEventBus.emitTaskUpdate(updatedTaskAtStart);
  }

  const localTime = formatLocalTime(startedAt, task.timezone);
  await deps.sendMessage(
    task.chat_jid,
    `🔄 Task ${shortId} started (${task.group_folder}) at ${localTime}`,
  );

  logger.info(
    { taskId: task.id, runId, group: task.group_folder },
    'Running scheduled task',
  );

  // Update tasks snapshot for agent to read (filtered by group)
  const isMain = task.group_folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    task.group_folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  let result: string | null = null;
  let error: string | null = null;

  // For group context mode, use the group's current session
  const sessions = deps.getSessions();
  const sessionId =
    task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  // Idle timer: writes _close sentinel after IDLE_TIMEOUT of no output,
  // so the agent exits instead of hanging at waitForIpcMessage forever.
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { taskId: task.id },
        'Scheduled task idle timeout, closing agent stdin',
      );
      deps.queue.closeStdin(task.group_folder);
    }, IDLE_TIMEOUT);
  };

  try {
    const output = await runProcessAgent(
      group,
      {
        prompt: task.prompt,
        sessionId,
        groupFolder: task.group_folder,
        chatJid: task.chat_jid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
      },
      (proc, processName) =>
        deps.onProcess(
          task.group_folder,
          proc,
          processName,
          task.group_folder,
          task.chat_jid,
        ),
      async (streamedOutput: AgentOutput) => {
        if (streamedOutput.result) {
          result = streamedOutput.result;
          // Forward result to user (sendMessage handles formatting)
          await deps.sendMessage(task.chat_jid, streamedOutput.result);
          // Only reset idle timer on actual results, not session-update markers
          resetIdleTimer();
        }
        if (streamedOutput.status === 'error') {
          error = streamedOutput.error || 'Unknown error';
        }
      },
    );

    if (idleTimer) clearTimeout(idleTimer);

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      // Messages are sent via MCP tool (IPC), result text is just logged
      result = output.result;
    }

    logger.info(
      { taskId: task.id, runId, durationMs: Date.now() - startTime },
      'Task completed',
    );
  } catch (err) {
    if (idleTimer) clearTimeout(idleTimer);
    error = err instanceof Error ? err.message : String(err);
    logger.error({ taskId: task.id, runId, error }, 'Task failed');
  }

  const durationMs = Date.now() - startTime;

  // Guard: task may have been deleted mid-execution (via IPC or WebUI)
  if (!getTaskById(task.id)) {
    logger.warn(
      { taskId: task.id, durationMs },
      'Task was deleted during execution, skipping run log',
    );
    return;
  }

  // --- On finish ---
  let nextRun: string | null = null;
  if (task.schedule_type === 'cron') {
    const interval = CronExpressionParser.parse(task.schedule_value, {
      tz: task.timezone || TIMEZONE,
    });
    nextRun = interval.next().toISOString();
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    nextRun = new Date(Date.now() + ms).toISOString();
  }
  // 'once' tasks have no next run

  const finishedAt = new Date().toISOString();
  const status: 'success' | 'error' = error ? 'error' : 'success';
  markTaskRunFinished(task.id, runId, finishedAt, durationMs, status, nextRun, result, error);
  pruneTaskRunEvents(task.id, 200);

  const updatedTaskAtFinish = getTaskById(task.id);
  if (updatedTaskAtFinish) {
    taskEventBus.emitTaskUpdate(updatedTaskAtFinish);
  }

  const durationStr = formatDuration(durationMs);
  if (error) {
    await deps.sendMessage(
      task.chat_jid,
      `❌ Task ${shortId} failed in ${durationStr}: ${error}`,
    );
  } else {
    await deps.sendMessage(
      task.chat_jid,
      `✅ Task ${shortId} finished in ${durationStr}`,
    );
  }
}

let schedulerRunning = false;

export function startSchedulerLoop(deps: SchedulerDependencies): void {
  if (schedulerRunning) {
    logger.debug('Scheduler loop already running, skipping duplicate start');
    return;
  }
  schedulerRunning = true;
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        deps.queue.enqueueTask(currentTask.group_folder, currentTask.id, () =>
          runTask(currentTask, deps),
        );
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}

/** @internal - for tests only. */
export function _resetSchedulerLoopForTests(): void {
  schedulerRunning = false;
}
