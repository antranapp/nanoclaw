/**
 * Browser-timezone-aware date formatting utilities.
 *
 * All functions explicitly pass the browser timezone so dates render
 * consistently regardless of the server's timezone configuration.
 */

/** Browser timezone, resolved once at module load. */
export const BROWSER_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Short date + medium time in browser timezone (e.g. "2/25/26, 3:04:05 PM"). */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: BROWSER_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

/** Medium date + short time in browser timezone (e.g. "Feb 25, 2026, 3:04 PM"). */
export function formatDateTimeMedium(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: BROWSER_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

/** Time only in browser timezone (e.g. "3:04 PM"). */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: BROWSER_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

/** Short date in browser timezone (e.g. "2/25/2026"). */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      timeZone: BROWSER_TIMEZONE,
    });
  } catch {
    return iso;
  }
}

/** Human-readable relative time until a future ISO date (e.g. "5m", "2h"). */
export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    const diffMs = d.getTime() - Date.now();
    if (diffMs < 0) return 'Overdue';
    if (diffMs < 60_000) return 'Less than a minute';
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    if (diffMs < 86_400_000) return `${Math.round(diffMs / 3_600_000)}h`;
    return formatDate(isoString);
  } catch {
    return isoString;
  }
}

/** Elapsed time since a past ISO date (e.g. "5m 23s"). */
export function formatElapsed(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  if (diff < 0) return '0s';
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / 60_000) % 60;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Human-readable duration from milliseconds (e.g. "1h 30m", "45s"). */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60_000) % 60;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
