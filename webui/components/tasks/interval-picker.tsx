'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface IntervalPickerProps {
  value: string; // milliseconds as string
  onChange: (ms: string) => void;
}

export function IntervalPicker({ value, onChange }: IntervalPickerProps) {
  const totalMs = parseInt(value, 10) || 0;
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);

  function update(h: number, m: number) {
    const ms = h * 3_600_000 + m * 60_000;
    onChange(String(Math.max(ms, 60_000))); // minimum 1 minute
  }

  return (
    <div className="flex items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="interval-hours">Hours</Label>
        <Input
          id="interval-hours"
          type="number"
          min={0}
          max={720}
          value={hours}
          onChange={(e) => update(parseInt(e.target.value, 10) || 0, minutes)}
          className="w-20"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="interval-minutes">Minutes</Label>
        <Input
          id="interval-minutes"
          type="number"
          min={0}
          max={59}
          value={minutes}
          onChange={(e) => update(hours, parseInt(e.target.value, 10) || 0)}
          className="w-20"
        />
      </div>
    </div>
  );
}
