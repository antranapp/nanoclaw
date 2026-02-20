'use client';

import { useCallback, useEffect, useState } from 'react';

export interface Task {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface Group {
  jid: string;
  name: string;
  folder: string;
}

export type CreateTaskInput = Pick<
  Task,
  'group_folder' | 'chat_jid' | 'prompt' | 'schedule_type' | 'schedule_value' | 'context_mode' | 'status'
>;

export type UpdateTaskInput = Partial<
  Pick<
    Task,
    'prompt' | 'schedule_type' | 'schedule_value' | 'context_mode' | 'group_folder' | 'chat_jid' | 'status'
  >
>;

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    Promise.all([fetchTasks(), fetchGroups()]).finally(() => setLoading(false));
  }, [fetchTasks, fetchGroups]);

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

  return { tasks, groups, loading, createTask, updateTask, deleteTask, pauseTask, resumeTask };
}
