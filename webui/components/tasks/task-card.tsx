'use client';

import { useMemo } from 'react';
import cronstrue from 'cronstrue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Pencil, Pause, Play, Trash2 } from 'lucide-react';
import type { Task, Group } from '@/hooks/use-tasks';

interface TaskCardProps {
  task: Task;
  groups: Group[];
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}

function formatSchedule(task: Task): string {
  if (task.schedule_type === 'cron') {
    try {
      return cronstrue.toString(task.schedule_value);
    } catch {
      return task.schedule_value;
    }
  }
  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0 && minutes > 0) return `Every ${hours}h ${minutes}m`;
    if (hours > 0) return `Every ${hours}h`;
    return `Every ${minutes}m`;
  }
  // once
  try {
    return `Once at ${new Date(task.schedule_value).toLocaleString()}`;
  } catch {
    return task.schedule_value;
  }
}

function formatNextRun(isoString: string | null): string {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    if (diffMs < 0) return 'Overdue';
    if (diffMs < 60_000) return 'Less than a minute';
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h`;
    return d.toLocaleDateString();
  } catch {
    return isoString;
  }
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  completed: 'outline',
};

export function TaskCard({ task, groups, onEdit, onPause, onResume, onDelete }: TaskCardProps) {
  const schedule = useMemo(() => formatSchedule(task), [task]);
  const groupName = groups.find((g) => g.folder === task.group_folder)?.name || task.group_folder;
  const nextRun = formatNextRun(task.next_run);

  return (
    <div className="rounded-lg border bg-white/60 backdrop-blur p-4 space-y-2">
      {/* Top: prompt + status */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium line-clamp-2 flex-1">{task.prompt}</p>
        <Badge variant={STATUS_VARIANT[task.status] ?? 'outline'} className="shrink-0">
          {task.status}
        </Badge>
      </div>

      {/* Schedule + group + next run */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{schedule}</span>
        <span>{groupName}</span>
        {task.status === 'active' && task.next_run && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">Next: {nextRun}</span>
              </TooltipTrigger>
              <TooltipContent>
                {new Date(task.next_run).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 pt-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>

          {task.status === 'active' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPause}>
                  <Pause className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Pause</TooltipContent>
            </Tooltip>
          ) : task.status === 'paused' ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onResume}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Resume</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}
