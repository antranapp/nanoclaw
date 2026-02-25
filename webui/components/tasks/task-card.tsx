'use client';

import { useMemo } from 'react';
import cronstrue from 'cronstrue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Activity, History, Pencil, Pause, Play, Trash2 } from 'lucide-react';
import {
  BROWSER_TIMEZONE,
  formatDate,
  formatDateTimeMedium,
  formatDurationMs,
  formatElapsed,
  formatRelativeTime,
} from '@/lib/date';
import type { Task, Group } from '@/hooks/use-tasks';

interface TaskCardProps {
  task: Task;
  groups: Group[];
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onViewHistory: () => void;
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
    return `Once at ${new Date(task.schedule_value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BROWSER_TIMEZONE,
    })}`;
  } catch {
    return task.schedule_value;
  }
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  running: 'default',
  active: 'default',
  paused: 'secondary',
  completed: 'outline',
};

export function TaskCard({ task, groups, onEdit, onPause, onResume, onDelete, onViewHistory }: TaskCardProps) {
  const schedule = useMemo(() => formatSchedule(task), [task]);
  const groupName = groups.find((g) => g.folder === task.group_folder)?.name || task.group_folder;
  const nextRun = formatRelativeTime(task.next_run);
  const isRunning = task.run_state === 'running';

  // Badge priority: running > active/paused/completed
  const badgeLabel = isRunning ? 'running' : task.status;
  const badgeVariant = STATUS_VARIANT[badgeLabel] ?? 'outline';

  return (
    <div className="rounded-lg border bg-white/60 backdrop-blur p-4 space-y-2">
      {/* Top: prompt + status */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium line-clamp-2 flex-1">{task.prompt}</p>
        <Badge variant={badgeVariant} className={`shrink-0 ${isRunning ? 'animate-pulse' : ''}`}>
          {isRunning && <Activity className="h-3 w-3 mr-1" />}
          {badgeLabel}
        </Badge>
      </div>

      {/* Schedule + group + next run */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{schedule}</span>
        <span>{groupName}</span>
        {task.status === 'active' && task.next_run && !isRunning && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">Next: {nextRun}</span>
              </TooltipTrigger>
              <TooltipContent>
                {formatDateTimeMedium(task.next_run)}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Run info section */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {isRunning && task.run_started_at && (
          <span className="text-blue-600 font-medium">
            Running for {formatElapsed(task.run_started_at)}
          </span>
        )}
        {!isRunning && task.last_run_status && (
          <span>
            {task.last_run_status === 'success' ? '✅' : '❌'} Last run: {task.last_run_status}
            {task.last_duration_ms != null && ` (${formatDurationMs(task.last_duration_ms)})`}
          </span>
        )}
        {!isRunning && task.last_error && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-destructive cursor-default truncate max-w-[200px]">
                  {task.last_error}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm">
                <p className="whitespace-pre-wrap text-xs">{task.last_error}</p>
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onViewHistory}>
                <History className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Run History</TooltipContent>
          </Tooltip>

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
