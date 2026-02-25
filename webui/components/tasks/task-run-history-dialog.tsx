'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BROWSER_TIMEZONE, formatDateTime, formatDurationMs } from '@/lib/date';
import type { TaskRunEvent } from '@/hooks/use-tasks';

interface TaskRunHistoryDialogProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchTaskRuns: (taskId: string, limit?: number) => Promise<TaskRunEvent[]>;
}

interface RunGroup {
  runId: string;
  start?: TaskRunEvent;
  finish?: TaskRunEvent;
}

export function TaskRunHistoryDialog({ taskId, open, onOpenChange, fetchTaskRuns }: TaskRunHistoryDialogProps) {
  const [events, setEvents] = useState<TaskRunEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !taskId) return;
    setLoading(true);
    fetchTaskRuns(taskId, 100)
      .then(setEvents)
      .finally(() => setLoading(false));
  }, [open, taskId, fetchTaskRuns]);

  const runs = useMemo(() => {
    const map = new Map<string, RunGroup>();
    for (const ev of events) {
      if (!map.has(ev.run_id)) {
        map.set(ev.run_id, { runId: ev.run_id });
      }
      const group = map.get(ev.run_id)!;
      if (ev.event_type === 'start') group.start = ev;
      if (ev.event_type === 'finish') group.finish = ev;
    }
    // Sort by start time descending (most recent first)
    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.start?.event_at || a.finish?.event_at || '';
      const bTime = b.start?.event_at || b.finish?.event_at || '';
      return bTime.localeCompare(aTime);
    });
  }, [events]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run History</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground -mt-2">
          Times shown in {BROWSER_TIMEZONE}
        </p>

        <ScrollArea className="max-h-[400px]">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No run history yet</p>
          ) : (
            <div className="space-y-3 pr-3">
              {runs.map((run) => (
                <div key={run.runId} className="rounded border p-3 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-muted-foreground">{run.runId.slice(0, 8)}</span>
                    {run.finish?.status && (
                      <Badge variant={run.finish.status === 'success' ? 'default' : 'destructive'}>
                        {run.finish.status}
                      </Badge>
                    )}
                    {!run.finish && run.start && (
                      <Badge variant="secondary" className="animate-pulse">running</Badge>
                    )}
                  </div>

                  {run.start && (
                    <p className="text-muted-foreground">
                      Started: {formatDateTime(run.start.event_at)}
                    </p>
                  )}
                  {run.finish && (
                    <p className="text-muted-foreground">
                      Finished: {formatDateTime(run.finish.event_at)}
                    </p>
                  )}
                  {run.finish?.duration_ms != null && (
                    <p className="text-muted-foreground">
                      Duration: {formatDurationMs(run.finish.duration_ms)}
                    </p>
                  )}
                  {run.finish?.result && (
                    <p className="text-muted-foreground truncate">
                      Result: {run.finish.result.slice(0, 100)}
                    </p>
                  )}
                  {run.finish?.error && (
                    <p className="text-destructive truncate">
                      Error: {run.finish.error}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
