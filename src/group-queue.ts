import { ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR, MAX_CONCURRENT_AGENTS } from './config.js';
import { logger } from './logger.js';

interface QueuedTask {
  id: string;
  groupKey: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;

interface GroupState {
  active: boolean;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  process: ChildProcess | null;
  processName: string | null;
  groupFolder: string | null;
  activeChatJid: string | null;
  retryCount: number;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private activeCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupKey: string) => Promise<boolean>) | null =
    null;
  private shuttingDown = false;

  private getGroup(groupKey: string): GroupState {
    let state = this.groups.get(groupKey);
    if (!state) {
      state = {
        active: false,
        pendingMessages: false,
        pendingTasks: [],
        process: null,
        processName: null,
        groupFolder: null,
        activeChatJid: null,
        retryCount: 0,
      };
      this.groups.set(groupKey, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupKey: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(groupKey: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupKey);

    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ groupKey }, 'Agent active, message queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_AGENTS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupKey)) {
        this.waitingGroups.push(groupKey);
      }
      logger.debug(
        { groupKey, activeCount: this.activeCount },
        'At concurrency limit, message queued',
      );
      return;
    }

    this.runForGroup(groupKey, 'messages');
  }

  enqueueTask(groupKey: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupKey);

    // Prevent double-queuing of the same task
    if (state.pendingTasks.some((t) => t.id === taskId)) {
      logger.debug({ groupKey, taskId }, 'Task already queued, skipping');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupKey, fn });
      logger.debug({ groupKey, taskId }, 'Agent active, task queued');
      return;
    }

    if (this.activeCount >= MAX_CONCURRENT_AGENTS) {
      state.pendingTasks.push({ id: taskId, groupKey, fn });
      if (!this.waitingGroups.includes(groupKey)) {
        this.waitingGroups.push(groupKey);
      }
      logger.debug(
        { groupKey, taskId, activeCount: this.activeCount },
        'At concurrency limit, task queued',
      );
      return;
    }

    // Run immediately
    this.runTask(groupKey, { id: taskId, groupKey, fn });
  }

  registerProcess(
    groupKey: string,
    proc: ChildProcess,
    processName: string,
    groupFolder?: string,
    activeChatJid?: string,
  ): void {
    const state = this.getGroup(groupKey);
    state.process = proc;
    state.processName = processName;
    if (groupFolder) state.groupFolder = groupFolder;
    if (activeChatJid) state.activeChatJid = activeChatJid;
  }

  /**
   * Send a follow-up message to the active agent via IPC file.
   * Returns true if the message was written, false if no active agent.
   */
  sendMessage(groupKey: string, text: string, chatJid?: string): boolean {
    const state = this.getGroup(groupKey);
    if (!state.active || !state.groupFolder) return false;
    if (chatJid && state.activeChatJid && state.activeChatJid !== chatJid) {
      return false;
    }

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Signal the active agent to wind down by writing a close sentinel.
   */
  closeStdin(groupKey: string): void {
    const state = this.getGroup(groupKey);
    if (!state.active || !state.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }
  }

  private async runForGroup(
    groupKey: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupKey);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug(
      { groupKey, reason, activeCount: this.activeCount },
      'Starting agent for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupKey);
        if (success) {
          state.retryCount = 0;
        } else {
          this.scheduleRetry(groupKey, state);
        }
      }
    } catch (err) {
      logger.error({ groupKey, err }, 'Error processing messages for group');
      this.scheduleRetry(groupKey, state);
    } finally {
      state.active = false;
      state.process = null;
      state.processName = null;
      state.groupFolder = null;
      state.activeChatJid = null;
      this.activeCount--;
      this.drainGroup(groupKey);
    }
  }

  private async runTask(groupKey: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupKey);
    state.active = true;
    this.activeCount++;

    logger.debug(
      { groupKey, taskId: task.id, activeCount: this.activeCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupKey, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.process = null;
      state.processName = null;
      state.groupFolder = null;
      state.activeChatJid = null;
      this.activeCount--;
      this.drainGroup(groupKey);
    }
  }

  private scheduleRetry(groupKey: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupKey, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupKey, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupKey);
      }
    }, delayMs);
  }

  private drainGroup(groupKey: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupKey);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupKey, task);
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(groupKey, 'drain');
      return;
    }

    // Nothing pending for this group; check if other groups are waiting for a slot
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (
      this.waitingGroups.length > 0 &&
      this.activeCount < MAX_CONCURRENT_AGENTS
    ) {
      const nextJid = this.waitingGroups.shift()!;
      const state = this.getGroup(nextJid);

      // Prioritize tasks over messages
      if (state.pendingTasks.length > 0) {
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task);
      } else if (state.pendingMessages) {
        this.runForGroup(nextJid, 'drain');
      }
      // If neither pending, skip this group
    }
  }

  async shutdown(_gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    // Count active agents but don't kill them — they'll finish on their own
    // via idle timeout or agent timeout.
    // This prevents WhatsApp reconnection restarts from killing working agents.
    const activeAgents: string[] = [];
    for (const [jid, state] of this.groups) {
      if (state.process && !state.process.killed && state.processName) {
        activeAgents.push(state.processName);
      }
    }

    logger.info(
      { activeCount: this.activeCount, detachedAgents: activeAgents },
      'GroupQueue shutting down (agents detached, not killed)',
    );
  }
}
