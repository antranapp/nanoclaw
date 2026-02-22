'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
import { CronEditor } from './cron-editor';
import { IntervalPicker } from './interval-picker';
import type { Task, Group, CreateTaskInput, UpdateTaskInput } from '@/hooks/use-tasks';

const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function isoToLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  groups: Group[];
  onSave: (input: CreateTaskInput | UpdateTaskInput) => Promise<void>;
}

export function TaskDialog({ open, onOpenChange, task, groups, onSave }: TaskDialogProps) {
  const isEdit = !!task;

  const [prompt, setPrompt] = useState('');
  const [groupFolder, setGroupFolder] = useState('');
  const [scheduleType, setScheduleType] = useState<'cron' | 'interval' | 'once'>('cron');
  const [scheduleValue, setScheduleValue] = useState('0 9 * * *');
  const [contextMode, setContextMode] = useState<'group' | 'isolated'>('isolated');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (task) {
        setPrompt(task.prompt);
        setGroupFolder(task.group_folder);
        setScheduleType(task.schedule_type);
        setScheduleValue(task.schedule_value);
        setContextMode(task.context_mode);
      } else {
        setPrompt('');
        setGroupFolder(groups[0]?.folder || '');
        setScheduleType('cron');
        setScheduleValue('0 9 * * *');
        setContextMode('isolated');
      }
    }
  }, [open, task, groups]);

  const selectedGroup = groups.find((g) => g.folder === groupFolder);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !groupFolder) return;

    setSaving(true);
    try {
      const chatJid = selectedGroup?.jid || `web:${groupFolder}`;
      if (isEdit) {
        await onSave({
          prompt,
          group_folder: groupFolder,
          chat_jid: chatJid,
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          context_mode: contextMode,
          timezone: BROWSER_TIMEZONE,
        } satisfies UpdateTaskInput);
      } else {
        await onSave({
          prompt,
          group_folder: groupFolder,
          chat_jid: chatJid,
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          context_mode: contextMode,
          timezone: BROWSER_TIMEZONE,
          status: 'active',
        } satisfies CreateTaskInput);
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Task' : 'New Scheduled Task'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Prompt */}
          <div className="space-y-1.5">
            <Label htmlFor="prompt">Prompt</Label>
            <Textarea
              id="prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={3}
              required
            />
          </div>

          {/* Group */}
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Select value={groupFolder} onValueChange={setGroupFolder}>
              <SelectTrigger>
                <SelectValue placeholder="Select a group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.folder} value={g.folder}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schedule Type */}
          <div className="space-y-1.5">
            <Label>Schedule Type</Label>
            <Select value={scheduleType} onValueChange={(v) => {
              const t = v as 'cron' | 'interval' | 'once';
              setScheduleType(t);
              if (t === 'cron') setScheduleValue('0 9 * * *');
              else if (t === 'interval') setScheduleValue('3600000');
              else setScheduleValue(new Date(Date.now() + 3_600_000).toISOString());
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cron">Cron (recurring)</SelectItem>
                <SelectItem value="interval">Interval (every N hours/minutes)</SelectItem>
                <SelectItem value="once">Once (run once at a specific time)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Schedule Value (dynamic editor) */}
          <div className="space-y-1.5">
            <Label>Schedule</Label>
            {scheduleType === 'cron' && (
              <CronEditor value={scheduleValue} onChange={setScheduleValue} timezone={BROWSER_TIMEZONE} />
            )}
            {scheduleType === 'interval' && (
              <IntervalPicker value={scheduleValue} onChange={setScheduleValue} />
            )}
            {scheduleType === 'once' && (
              <input
                type="datetime-local"
                value={isoToLocalDatetime(scheduleValue)}
                onChange={(e) => setScheduleValue(new Date(e.target.value).toISOString())}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            )}
          </div>

          {/* Context Mode */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label htmlFor="context-mode">Use group context</Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-[250px]">
                    <p className="text-xs">
                      <strong>Group:</strong> Agent resumes the group&apos;s conversation session. <br />
                      <strong>Isolated:</strong> Agent runs with a fresh session each time.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Switch
              id="context-mode"
              checked={contextMode === 'group'}
              onCheckedChange={(checked) => setContextMode(checked ? 'group' : 'isolated')}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !prompt.trim() || !groupFolder}>
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
