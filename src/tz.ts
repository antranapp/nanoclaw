/**
 * Timezone conversion utilities.
 *
 * Converts a "local time" string (without timezone indicator) into a UTC ISO
 * string, given an IANA timezone name (e.g. "Asia/Ho_Chi_Minh").
 *
 * Uses only built-in Intl APIs — no external dependencies.
 */

/**
 * Convert a local datetime string to a UTC ISO string.
 *
 * @param localStr  Datetime WITHOUT timezone, e.g. "2026-02-25T06:43:14"
 * @param timezone  IANA timezone, e.g. "America/New_York"
 * @returns         UTC ISO string, e.g. "2026-02-24T23:43:14.000Z"
 */
export function localToUtcIso(localStr: string, timezone: string): string {
  // Parse numeric components from the local string
  const m = localStr.match(
    /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) throw new Error(`Invalid local datetime: ${localStr}`);

  const [, year, month, day, hour, minute, second = '0'] = m;

  // Treat the local components as if they were UTC to get a reference point
  const naiveUtcMs = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);

  // Format that same UTC instant in the target timezone to find the offset
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naiveUtcMs));
  const get = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

  // What the naive UTC instant looks like in the target timezone
  const h = get('hour') % 24; // Intl may return 24 for midnight
  const tzViewMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    h,
    get('minute'),
    get('second'),
  );

  // offset = tzView - naiveUtc  (positive when timezone is ahead of UTC)
  const offsetMs = tzViewMs - naiveUtcMs;

  // The actual UTC time: naiveUtc - offset
  return new Date(naiveUtcMs - offsetMs).toISOString();
}

/**
 * Format the current local time in a timezone as an ISO-like string
 * (without Z suffix), e.g. "2026-02-25T06:43:14".
 */
export function nowLocal(timezone: string): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  // en-CA gives "YYYY-MM-DD, HH:MM:SS" format
  return fmt.format(now).replace(', ', 'T').replace(/24:/, '00:');
}
