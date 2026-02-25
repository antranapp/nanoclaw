'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Task {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  timezone?: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
  // Run-state fields
  run_state: 'idle' | 'running';
  current_run_id: string | null;
  run_started_at: string | null;
  last_run_status: 'success' | 'error' | null;
  last_error: string | null;
  last_duration_ms: number | null;
}

export interface TaskRunEvent {
  id: number;
  task_id: string;
  run_id: string;
  event_type: 'start' | 'finish';
  event_at: string;
  status: 'success' | 'error' | null;
  duration_ms: number | null;
  result: string | null;
  error: string | null;
}

export interface Group {
  jid: string;
  name: string;
  folder: string;
}

export type CreateTaskInput = Pick<
  Task,
  'group_folder' | 'chat_jid' | 'prompt' | 'schedule_type' | 'schedule_value' | 'context_mode' | 'timezone' | 'status'
>;

export type UpdateTaskInput = Partial<
  Pick<
    Task,
    'prompt' | 'schedule_type' | 'schedule_value' | 'context_mode' | 'timezone' | 'group_folder' | 'chat_jid' | 'status'
  >
>;

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/groups');
      const data = await res.json();
      if (Array.isArray(data.groups)) setGroups(data.groups);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchTaskRuns = useCallback(
    async (taskId: string, limit = 20): Promise<TaskRunEvent[]> => {
      try {
        const res = await fetch(
          `/api/tasks/${encodeURIComponent(taskId)}/runs?limit=${limit}`,
        );
        const data = await res.json();
        return Array.isArray(data.events) ? data.events : [];
      } catch {
        return [];
      }
    },
    [],
  );

  useEffect(() => {
    Promise.all([fetchTasks(), fetchGroups()]).finally(() => setLoading(false));
  }, [fetchTasks, fetchGroups]);

  // WebSocket listener for real-time task updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;

    function connect() {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);
          if (frame.type === 'task_update' && frame.task) {
            setTasks((prev) =>
              prev.map((t) => (t.id === frame.task.id ? frame.task : t)),
            );
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    }

    connect();

    // Fallback polling in case WS disconnects
    const pollInterval = setInterval(fetchTasks, 10_000);

    return () => {
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [fetchTasks]);

  const createTask = useCallback(
    async (input: CreateTaskInput) => {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      await fetchTasks();
    },
    [fetchTasks],
  );

  const updateTask = useCallback(
    async (id: string, input: UpdateTaskInput) => {
      await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      await fetchTasks();
    },
    [fetchTasks],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await fetchTasks();
    },
    [fetchTasks],
  );

  const pauseTask = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${encodeURIComponent(id)}/pause`, { method: 'POST' });
      await fetchTasks();
    },
    [fetchTasks],
  );

  const resumeTask = useCallback(
    async (id: string) => {
      await fetch(`/api/tasks/${encodeURIComponent(id)}/resume`, { method: 'POST' });
      await fetchTasks();
    },
    [fetchTasks],
  );

  return { tasks, groups, loading, createTask, updateTask, deleteTask, pauseTask, resumeTask, fetchTaskRuns };
}
