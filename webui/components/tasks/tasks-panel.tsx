'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, CalendarClock } from 'lucide-react';
import { useTasks } from '@/hooks/use-tasks';
import { TaskCard } from './task-card';
import { TaskDialog } from './task-dialog';
import type { CreateTaskInput, UpdateTaskInput } from '@/hooks/use-tasks';

export function TasksPanel() {
  const { tasks, groups, loading, createTask, updateTask, deleteTask, pauseTask, resumeTask } = useTasks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<typeof tasks[0] | null>(null);

  function openCreate() {
    setEditingTask(null);
    setDialogOpen(true);
  }

  function openEdit(task: typeof tasks[0]) {
    setEditingTask(task);
    setDialogOpen(true);
  }

  async function handleSave(input: CreateTaskInput | UpdateTaskInput) {
    if (editingTask) {
      await updateTask(editingTask.id, input as UpdateTaskInput);
    } else {
      await createTask(input as CreateTaskInput);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-black/10 bg-white/60 backdrop-blur">
        <h2 className="text-lg font-semibold">Scheduled Tasks</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Task
        </Button>
      </div>

      {/* Task list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <CalendarClock className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm font-medium">No scheduled tasks</p>
              <p className="text-xs mt-1">Create one to run prompts on a schedule</p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                groups={groups}
                onEdit={() => openEdit(task)}
                onPause={() => pauseTask(task.id)}
                onResume={() => resumeTask(task.id)}
                onDelete={() => deleteTask(task.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        groups={groups}
        onSave={handleSave}
      />
    </div>
  );
}
