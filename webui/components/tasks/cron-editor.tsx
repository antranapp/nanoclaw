'use client';

import { useState, useMemo } from 'react';
import cronstrue from 'cronstrue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface CronEditorProps {
  value: string;
  onChange: (cron: string) => void;
}

type Frequency = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

const PRESETS: { label: string; cron: string }[] = [
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Daily 9am', cron: '0 9 * * *' },
  { label: 'Mon-Fri 9am', cron: '0 9 * * 1-5' },
  { label: 'Weekly Mon', cron: '0 9 * * 1' },
  { label: 'Monthly 1st', cron: '0 9 1 * *' },
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseCronToSimple(cron: string): { frequency: Frequency; hour: number; minute: number; day: number } {
  const parts = cron.split(' ');
  if (parts.length !== 5) return { frequency: 'daily', hour: 9, minute: 0, day: 1 };

  const [min, hr, dom, , dow] = parts;
  const minute = min === '*' ? 0 : parseInt(min, 10);
  const hour = hr === '*' ? 0 : parseInt(hr, 10);

  if (hr === '*') return { frequency: 'hourly', hour: 0, minute, day: 1 };
  if (dow === '1-5') return { frequency: 'weekdays', hour, minute, day: 1 };
  if (dow !== '*' && dom === '*') return { frequency: 'weekly', hour, minute, day: parseInt(dow, 10) };
  if (dom !== '*') return { frequency: 'monthly', hour, minute, day: parseInt(dom, 10) };
  return { frequency: 'daily', hour, minute, day: 1 };
}

function buildCron(frequency: Frequency, hour: number, minute: number, day: number): string {
  switch (frequency) {
    case 'hourly': return `${minute} * * * *`;
    case 'daily': return `${minute} ${hour} * * *`;
    case 'weekdays': return `${minute} ${hour} * * 1-5`;
    case 'weekly': return `${minute} ${hour} * * ${day}`;
    case 'monthly': return `${minute} ${hour} ${day} * *`;
  }
}

function getHumanReadable(cron: string): string {
  try {
    return cronstrue.toString(cron);
  } catch {
    return 'Invalid expression';
  }
}

export function CronEditor({ value, onChange }: CronEditorProps) {
  const parsed = useMemo(() => parseCronToSimple(value), [value]);
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple');
  const [frequency, setFrequency] = useState<Frequency>(parsed.frequency);
  const [hour, setHour] = useState(parsed.hour);
  const [minute, setMinute] = useState(parsed.minute);
  const [day, setDay] = useState(parsed.day);
  const [rawCron, setRawCron] = useState(value || '0 9 * * *');

  const humanReadable = useMemo(() => getHumanReadable(mode === 'advanced' ? rawCron : value), [mode, rawCron, value]);

  function handleSimpleChange(f: Frequency, h: number, m: number, d: number) {
    setFrequency(f);
    setHour(h);
    setMinute(m);
    setDay(d);
    onChange(buildCron(f, h, m, d));
  }

  return (
    <div className="space-y-3">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.cron}
            type="button"
            variant={value === p.cron ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              const s = parseCronToSimple(p.cron);
              setFrequency(s.frequency);
              setHour(s.hour);
              setMinute(s.minute);
              setDay(s.day);
              setRawCron(p.cron);
              onChange(p.cron);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as 'simple' | 'advanced')}>
        <TabsList className="h-8">
          <TabsTrigger value="simple" className="text-xs">Simple</TabsTrigger>
          <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
        </TabsList>

        <TabsContent value="simple" className="space-y-3 mt-3">
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => handleSimpleChange(v as Frequency, hour, minute, day)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hourly">Every hour</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekdays">Weekdays (Mon-Fri)</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {frequency !== 'hourly' && (
            <div className="flex gap-3">
              <div className="space-y-1.5">
                <Label>Hour</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={hour}
                  onChange={(e) => handleSimpleChange(frequency, parseInt(e.target.value, 10) || 0, minute, day)}
                  className="w-20"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={minute}
                  onChange={(e) => handleSimpleChange(frequency, hour, parseInt(e.target.value, 10) || 0, day)}
                  className="w-20"
                />
              </div>
            </div>
          )}

          {frequency === 'hourly' && (
            <div className="space-y-1.5">
              <Label>At minute</Label>
              <Input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => handleSimpleChange(frequency, hour, parseInt(e.target.value, 10) || 0, day)}
                className="w-20"
              />
            </div>
          )}

          {frequency === 'weekly' && (
            <div className="space-y-1.5">
              <Label>Day of week</Label>
              <Select value={String(day)} onValueChange={(v) => handleSimpleChange(frequency, hour, minute, parseInt(v, 10))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map((d, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div className="space-y-1.5">
              <Label>Day of month</Label>
              <Input
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => handleSimpleChange(frequency, hour, minute, parseInt(e.target.value, 10) || 1)}
                className="w-20"
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="advanced" className="space-y-3 mt-3">
          <div className="space-y-1.5">
            <Label>Cron expression</Label>
            <Input
              value={rawCron}
              onChange={(e) => {
                setRawCron(e.target.value);
                onChange(e.target.value);
              }}
              placeholder="* * * * *"
              className="font-mono"
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Human-readable preview */}
      <p className="text-xs text-muted-foreground">{humanReadable}</p>
    </div>
  );
}
