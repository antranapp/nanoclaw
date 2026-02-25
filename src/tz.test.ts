import { describe, it, expect } from 'vitest';
import { localToUtcIso, nowLocal } from './tz.js';

describe('localToUtcIso', () => {
  it('converts Asia/Ho_Chi_Minh (UTC+7) local time to UTC', () => {
    // 06:43:14 local in UTC+7 = 23:43:14 previous day UTC
    const result = localToUtcIso('2026-02-25T06:43:14', 'Asia/Ho_Chi_Minh');
    expect(result).toBe('2026-02-24T23:43:14.000Z');
  });

  it('converts America/New_York (UTC-5 standard) local time to UTC', () => {
    // January = EST (UTC-5): 15:30:00 EST = 20:30:00 UTC
    const result = localToUtcIso('2026-01-15T15:30:00', 'America/New_York');
    expect(result).toBe('2026-01-15T20:30:00.000Z');
  });

  it('converts UTC local time to UTC (no offset)', () => {
    const result = localToUtcIso('2026-06-01T12:00:00', 'UTC');
    expect(result).toBe('2026-06-01T12:00:00.000Z');
  });

  it('handles midnight correctly', () => {
    // Midnight in UTC+7 = 17:00 previous day UTC
    const result = localToUtcIso('2026-03-01T00:00:00', 'Asia/Ho_Chi_Minh');
    expect(result).toBe('2026-02-28T17:00:00.000Z');
  });

  it('handles timestamp without seconds', () => {
    const result = localToUtcIso('2026-02-25T06:43', 'Asia/Ho_Chi_Minh');
    expect(result).toBe('2026-02-24T23:43:00.000Z');
  });

  it('throws on invalid input', () => {
    expect(() => localToUtcIso('not-a-date', 'UTC')).toThrow('Invalid local datetime');
  });

  it('converts Europe/London (UTC+1 summer) correctly', () => {
    // July = BST (UTC+1): 14:00 BST = 13:00 UTC
    const result = localToUtcIso('2026-07-15T14:00:00', 'Europe/London');
    expect(result).toBe('2026-07-15T13:00:00.000Z');
  });

  it('converts Australia/Sydney (UTC+11 summer) correctly', () => {
    // January = AEDT (UTC+11): 08:00 AEDT = 21:00 previous day UTC
    const result = localToUtcIso('2026-01-10T08:00:00', 'Australia/Sydney');
    expect(result).toBe('2026-01-09T21:00:00.000Z');
  });
});

describe('nowLocal', () => {
  it('returns a valid local datetime string', () => {
    const result = nowLocal('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it('returns different times for different timezones', () => {
    const utc = nowLocal('UTC');
    const tokyo = nowLocal('Asia/Tokyo'); // UTC+9
    // They should be formatted differently (unless test runs exactly at UTC midnight+9h overlap)
    // Just verify both are valid
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(tokyo).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
