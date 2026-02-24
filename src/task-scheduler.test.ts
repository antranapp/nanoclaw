import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  deleteTask,
  getTaskById,
  setRegisteredGroup,
} from './db.js';
import {
  _resetSchedulerLoopForTests,
  startSchedulerLoop,
} from './task-scheduler.js';
import type { RegisteredGroup } from './types.js';

// Mock process-runner so runTask doesn't spawn real processes
vi.mock('./process-runner.js', () => ({
  runAgent: vi.fn(async () => ({ status: 'success', result: 'done' })),
  writeTasksSnapshot: vi.fn(),
}));

// Mock logger to capture warnings
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from './logger.js';

const MAIN_GROUP: RegisteredGroup = {
  name: 'Main',
  folder: 'main',
  trigger: '@Andy',
  added_at: '2026-01-01T00:00:00.000Z',
};

describe('task scheduler', () => {
  beforeEach(() => {
    _initTestDatabase();
    _resetSchedulerLoopForTests();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses due tasks with invalid group folders to prevent retry churn', async () => {
    createTask({
      id: 'task-invalid-folder',
      group_folder: '../../outside',
      chat_jid: 'bad@g.us',
      prompt: 'run',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({}),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    const task = getTaskById('task-invalid-folder');
    expect(task?.status).toBe('paused');
  });

  it('skips logTaskRun when task is deleted mid-execution (race condition)', async () => {
    setRegisteredGroup('web:main', MAIN_GROUP, 'web');

    createTask({
      id: 'task-race',
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'do work',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    // Mock runAgent to delete the task during execution (simulates IPC/WebUI delete)
    const { runAgent } = await import('./process-runner.js');
    vi.mocked(runAgent).mockImplementation(async () => {
      deleteTask('task-race');
      return { status: 'success', result: 'done' } as any;
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    // Should not throw (before fix, FK constraint on logTaskRun would crash)
    startSchedulerLoop({
      registeredGroups: () => ({ 'web:main': MAIN_GROUP }),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    // Task was deleted during execution
    expect(getTaskById('task-race')).toBeUndefined();

    // Warning should have been logged
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-race' }),
      'Task was deleted during execution, skipping run log',
    );
  });

  it('still logs run and updates task when task exists after execution', async () => {
    setRegisteredGroup('web:main', MAIN_GROUP, 'web');

    createTask({
      id: 'task-normal',
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'normal work',
      schedule_type: 'once',
      schedule_value: '2026-02-22T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: new Date(Date.now() - 60_000).toISOString(),
      status: 'active',
      created_at: '2026-02-22T00:00:00.000Z',
    });

    const { runAgent } = await import('./process-runner.js');
    vi.mocked(runAgent).mockImplementation(async () => {
      // Task is NOT deleted — normal execution
      return { status: 'success', result: 'all good' } as any;
    });

    const enqueueTask = vi.fn(
      (_groupJid: string, _taskId: string, fn: () => Promise<void>) => {
        void fn();
      },
    );

    startSchedulerLoop({
      registeredGroups: () => ({ 'web:main': MAIN_GROUP }),
      getSessions: () => ({}),
      queue: { enqueueTask } as any,
      onProcess: () => {},
      sendMessage: async () => {},
    });

    await vi.advanceTimersByTimeAsync(10);

    // Task should be completed (once schedule, no next_run)
    const task = getTaskById('task-normal');
    expect(task).toBeDefined();
    expect(task!.status).toBe('completed');
    expect(task!.last_result).toBe('all good');

    // No race condition warning
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-normal' }),
      'Task was deleted during execution, skipping run log',
    );
  });
});
