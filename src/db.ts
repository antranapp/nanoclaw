import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { ASSISTANT_NAME, DATA_DIR, STORE_DIR, TIMEZONE } from './config.js';
import { isValidGroupFolder } from './group-folder.js';
import { logger } from './logger.js';
import {
  NewMessage,
  RegisteredGroup,
  ScheduledTask,
  TaskRunEvent,
  TaskRunLog,
} from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT,
      channel TEXT,
      is_group INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      is_bot_message INTEGER DEFAULT 0,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS task_run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_at TEXT NOT NULL,
      status TEXT,
      duration_ms INTEGER,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_events_task_at ON task_run_events(task_id, event_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_run_events_task_run ON task_run_events(task_id, run_id);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      group_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1,
      channel TEXT NOT NULL DEFAULT 'whatsapp'
    );
    CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);
  `);

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }

  // Add timezone column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN timezone TEXT DEFAULT '${TIMEZONE}'`,
    );
  } catch {
    /* column already exists */
  }

  // Add is_bot_message column if it doesn't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE messages ADD COLUMN is_bot_message INTEGER DEFAULT 0`,
    );
    // Backfill: mark existing bot messages that used the content prefix pattern
    database
      .prepare(`UPDATE messages SET is_bot_message = 1 WHERE content LIKE ?`)
      .run(`${ASSISTANT_NAME}:%`);
  } catch {
    /* column already exists */
  }

  // Add run-state columns to scheduled_tasks (migration for existing DBs)
  for (const col of [
    "run_state TEXT DEFAULT 'idle'",
    'current_run_id TEXT',
    'run_started_at TEXT',
    'last_run_status TEXT',
    'last_error TEXT',
    'last_duration_ms INTEGER',
  ]) {
    try {
      database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN ${col}`);
    } catch {
      /* already exists */
    }
  }

  // Add channel and is_group columns to chats if they don't exist (migration for existing DBs)
  try {
    database.exec(
      `ALTER TABLE chats ADD COLUMN channel TEXT`,
    );
    database.exec(
      `ALTER TABLE chats ADD COLUMN is_group INTEGER DEFAULT 0`,
    );
    // Backfill from JID patterns
    database.exec(`UPDATE chats SET channel = 'whatsapp', is_group = 1 WHERE jid LIKE '%@g.us'`);
    database.exec(`UPDATE chats SET channel = 'whatsapp', is_group = 0 WHERE jid LIKE '%@s.whatsapp.net'`);
    database.exec(`UPDATE chats SET channel = 'discord', is_group = 1 WHERE jid LIKE 'dc:%'`);
    database.exec(`UPDATE chats SET channel = 'telegram', is_group = 1 WHERE jid LIKE 'tg:%'`);
  } catch {
    /* columns already exist */
  }

  migrateRegisteredGroupsTable(database);
}

function migrateRegisteredGroupsTable(database: Database.Database): void {
  const tableSqlRow = database
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'registered_groups'`,
    )
    .get() as { sql: string } | undefined;

  const columns = database
    .prepare(`PRAGMA table_info(registered_groups)`)
    .all() as Array<{ name: string }>;

  const hasChannelColumn = columns.some((c) => c.name === 'channel');
  const hasUniqueFolderConstraint = tableSqlRow?.sql?.includes(
    'folder TEXT NOT NULL UNIQUE',
  );

  if (hasChannelColumn && !hasUniqueFolderConstraint) {
    database.exec(
      'CREATE INDEX IF NOT EXISTS idx_registered_groups_channel ON registered_groups(channel)',
    );
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS registered_groups_new (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL,
      trigger_pattern TEXT NOT NULL,
      added_at TEXT NOT NULL,
      container_config TEXT,
      requires_trigger INTEGER DEFAULT 1,
      channel TEXT NOT NULL DEFAULT 'whatsapp'
    );

    INSERT INTO registered_groups_new (
      jid,
      name,
      folder,
      trigger_pattern,
      added_at,
      container_config,
      requires_trigger,
      channel
    )
    SELECT
      jid,
      name,
      folder,
      trigger_pattern,
      added_at,
      container_config,
      requires_trigger,
      'whatsapp'
    FROM registered_groups;

    DROP TABLE registered_groups;
    ALTER TABLE registered_groups_new RENAME TO registered_groups;
    CREATE INDEX IF NOT EXISTS idx_registered_groups_folder ON registered_groups(folder);
    CREATE INDEX IF NOT EXISTS idx_registered_groups_channel ON registered_groups(channel);
  `);
}

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  createSchema(db);

  // Migrate from JSON files if they exist
  migrateJsonState();
}

/** @internal - for tests only. Creates a fresh in-memory database. */
export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
): void {
  const ch = channel ?? null;
  const group = isGroup === undefined ? null : isGroup ? 1 : 0;

  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, name, timestamp, ch, group);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time),
        channel = COALESCE(excluded.channel, channel),
        is_group = COALESCE(excluded.is_group, is_group)
    `,
    ).run(chatJid, chatJid, timestamp, ch, group);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time, channel, is_group
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get only chats that have a registered agent group, ordered by most recent activity.
 * This filters out unrelated WhatsApp chats that were synced for discovery purposes.
 */
export function getRegisteredChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT c.jid, c.name, c.last_message_time
    FROM chats c
    INNER JOIN registered_groups rg ON c.jid = rg.jid
    ORDER BY c.last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 */
export function storeMessage(msg: NewMessage): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

/**
 * Store a message directly (for non-WhatsApp channels that don't use Baileys proto).
 */
export function storeMessageDirect(msg: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message?: boolean;
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter bot messages using both the is_bot_message flag AND the content
  // prefix as a backstop for messages written before the migration ran.
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND content != '' AND content IS NOT NULL
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function getMessagesSinceForJids(
  chatJids: string[],
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  if (chatJids.length === 0) return [];

  const placeholders = chatJids.map(() => '?').join(',');
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid IN (${placeholders}) AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
    ORDER BY timestamp
  `;

  return db
    .prepare(sql)
    .all(...chatJids, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

export function getRecentMessages(chatJid: string, limit = 100): NewMessage[] {
  // Query in DESC for efficient LIMIT, then reverse for chat display order.
  const rows = db
    .prepare(
      `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(chatJid, limit) as NewMessage[];
  return rows.reverse();
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result' | 'run_state' | 'current_run_id' | 'run_started_at' | 'last_run_status' | 'last_error' | 'last_duration_ms'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, timezone, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.timezone || TIMEZONE,
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      | 'prompt'
      | 'schedule_type'
      | 'schedule_value'
      | 'next_run'
      | 'status'
      | 'context_mode'
      | 'timezone'
      | 'group_folder'
      | 'chat_jid'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.context_mode !== undefined) {
    fields.push('context_mode = ?');
    values.push(updates.context_mode);
  }
  if (updates.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(updates.timezone);
  }
  if (updates.group_folder !== undefined) {
    fields.push('group_folder = ?');
    values.push(updates.group_folder);
  }
  if (updates.chat_jid !== undefined) {
    fields.push('chat_jid = ?');
    values.push(updates.chat_jid);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  db.prepare('DELETE FROM task_run_events WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function markTaskRunStarted(
  taskId: string,
  runId: string,
  eventAt: string,
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO task_run_events (task_id, run_id, event_type, event_at)
       VALUES (?, ?, 'start', ?)`,
    ).run(taskId, runId, eventAt);

    db.prepare(
      `UPDATE scheduled_tasks
       SET run_state = 'running', current_run_id = ?, run_started_at = ?
       WHERE id = ?`,
    ).run(runId, eventAt, taskId);
  })();
}

export function markTaskRunFinished(
  taskId: string,
  runId: string,
  eventAt: string,
  durationMs: number,
  status: 'success' | 'error',
  nextRun: string | null,
  result: string | null,
  error: string | null,
): void {
  db.transaction(() => {
    // Insert finish event
    db.prepare(
      `INSERT INTO task_run_events (task_id, run_id, event_type, event_at, status, duration_ms, result, error)
       VALUES (?, ?, 'finish', ?, ?, ?, ?, ?)`,
    ).run(taskId, runId, eventAt, status, durationMs, result, error);

    // Reset run state, set last_run fields, advance next_run, auto-complete if once
    const lastResult = error ? `Error: ${error}` : result ? result.slice(0, 200) : 'Completed';
    db.prepare(
      `UPDATE scheduled_tasks
       SET run_state = 'idle',
           current_run_id = NULL,
           run_started_at = NULL,
           last_run = ?,
           last_result = ?,
           last_run_status = ?,
           last_error = ?,
           last_duration_ms = ?,
           next_run = ?,
           status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
       WHERE id = ?`,
    ).run(eventAt, lastResult, status, error, durationMs, nextRun, nextRun, taskId);

    // Legacy backward compat: also write to task_run_logs
    db.prepare(
      `INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(taskId, eventAt, durationMs, status, result, error);
  })();
}

export function getTaskRunEvents(
  taskId: string,
  limit = 20,
): TaskRunEvent[] {
  return db
    .prepare(
      `SELECT id, task_id, run_id, event_type, event_at, status, duration_ms, result, error
       FROM task_run_events
       WHERE task_id = ?
       ORDER BY event_at DESC
       LIMIT ?`,
    )
    .all(taskId, limit) as TaskRunEvent[];
}

export function pruneTaskRunEvents(
  taskId: string,
  keepRunCount = 200,
): void {
  // Get the run_ids to keep (most recent N runs by their earliest event time)
  const keepRuns = db
    .prepare(
      `SELECT run_id FROM task_run_events
       WHERE task_id = ?
       GROUP BY run_id
       ORDER BY MIN(event_at) DESC
       LIMIT ?`,
    )
    .all(taskId, keepRunCount) as Array<{ run_id: string }>;

  if (keepRuns.length < keepRunCount) return; // fewer than keepRunCount runs, nothing to prune

  const keepSet = keepRuns.map((r) => r.run_id);
  const placeholders = keepSet.map(() => '?').join(',');

  db.prepare(
    `DELETE FROM task_run_events
     WHERE task_id = ? AND run_id NOT IN (${placeholders})`,
  ).run(taskId, ...keepSet);
}

// --- Router state accessors ---

export function getRouterState(key: string): string | undefined {
  const row = db
    .prepare('SELECT value FROM router_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
  ).run(key, value);
}

// --- Session accessors ---

export function getSession(groupFolder: string): string | undefined {
  const row = db
    .prepare('SELECT session_id FROM sessions WHERE group_folder = ?')
    .get(groupFolder) as { session_id: string } | undefined;
  return row?.session_id;
}

export function setSession(groupFolder: string, sessionId: string): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, session_id) VALUES (?, ?)',
  ).run(groupFolder, sessionId);
}

export function getAllSessions(): Record<string, string> {
  const rows = db
    .prepare('SELECT group_folder, session_id FROM sessions')
    .all() as Array<{ group_folder: string; session_id: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.group_folder] = row.session_id;
  }
  return result;
}

// --- Registered group accessors ---

export function getRegisteredGroup(
  jid: string,
): (RegisteredGroup & { jid: string; channel: string }) | undefined {
  const row = db
    .prepare('SELECT * FROM registered_groups WHERE jid = ?')
    .get(jid) as
    | {
        jid: string;
        name: string;
        folder: string;
        trigger_pattern: string;
        added_at: string;
        container_config: string | null;
        requires_trigger: number | null;
        channel: string | null;
      }
    | undefined;
  if (!row) return undefined;
  if (!isValidGroupFolder(row.folder)) {
    logger.warn(
      { jid: row.jid, folder: row.folder },
      'Skipping registered group with invalid folder',
    );
    return undefined;
  }
  return {
    jid: row.jid,
    name: row.name,
    folder: row.folder,
    trigger: row.trigger_pattern,
    added_at: row.added_at,
    agentConfig: row.container_config
      ? JSON.parse(row.container_config)
      : undefined,
    requiresTrigger:
      row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    channel: row.channel || 'whatsapp',
  };
}

export function setRegisteredGroup(
  jid: string,
  group: RegisteredGroup,
  channel = 'whatsapp',
): void {
  if (!isValidGroupFolder(group.folder)) {
    throw new Error(`Invalid group folder "${group.folder}" for JID ${jid}`);
  }
  db.prepare(
    `INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    jid,
    group.name,
    group.folder,
    group.trigger,
    group.added_at,
    group.agentConfig ? JSON.stringify(group.agentConfig) : null,
    group.requiresTrigger === undefined ? 1 : group.requiresTrigger ? 1 : 0,
    channel,
  );
}

export function getAllRegisteredGroups(): Record<string, RegisteredGroup> {
  const rows = db.prepare('SELECT * FROM registered_groups').all() as Array<{
    jid: string;
    name: string;
    folder: string;
    trigger_pattern: string;
    added_at: string;
    container_config: string | null;
    requires_trigger: number | null;
    channel: string | null;
  }>;
  const result: Record<string, RegisteredGroup> = {};
  for (const row of rows) {
    if (!isValidGroupFolder(row.folder)) {
      logger.warn(
        { jid: row.jid, folder: row.folder },
        'Skipping registered group with invalid folder',
      );
      continue;
    }
    result[row.jid] = {
      name: row.name,
      folder: row.folder,
      trigger: row.trigger_pattern,
      added_at: row.added_at,
      agentConfig: row.container_config
        ? JSON.parse(row.container_config)
        : undefined,
      requiresTrigger:
        row.requires_trigger === null ? undefined : row.requires_trigger === 1,
    };
  }
  return result;
}

export function getRegisteredJidsForFolder(folder: string): string[] {
  const rows = db
    .prepare('SELECT jid FROM registered_groups WHERE folder = ?')
    .all(folder) as Array<{ jid: string }>;
  return rows.map((r) => r.jid);
}

/**
 * Get recent messages across ALL JIDs bound to a folder (cross-channel history).
 * Returns messages in chronological order.
 */
export function getRecentMessagesByFolder(
  folder: string,
  limit = 200,
): NewMessage[] {
  const jids = getRegisteredJidsForFolder(folder);
  if (jids.length === 0) return [];

  const placeholders = jids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `
      SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message
      FROM messages
      WHERE chat_jid IN (${placeholders})
      ORDER BY timestamp DESC
      LIMIT ?
    `,
    )
    .all(...jids, limit) as NewMessage[];
  return rows.reverse();
}

export interface GroupFolderInfo {
  name: string;
  folder: string;
  webJid: string | null;
}

/**
 * Get deduplicated group list grouped by folder.
 * Returns one entry per unique folder with the group name and web JID if it exists.
 */
export function getGroupFolders(): GroupFolderInfo[] {
  const rows = db
    .prepare('SELECT jid, name, folder FROM registered_groups ORDER BY folder')
    .all() as Array<{ jid: string; name: string; folder: string }>;

  const folderMap = new Map<
    string,
    { name: string; folder: string; webJid: string | null }
  >();

  for (const row of rows) {
    const existing = folderMap.get(row.folder);
    if (!existing) {
      folderMap.set(row.folder, {
        name: row.name,
        folder: row.folder,
        webJid: row.jid.startsWith('web:') ? row.jid : null,
      });
    } else if (row.jid.startsWith('web:')) {
      existing.webJid = row.jid;
    }
  }

  return Array.from(folderMap.values());
}

/**
 * Delete a group and all its associated data by folder.
 * Removes registered_groups, messages, chats, scheduled_tasks, and sessions.
 * Does NOT delete the group folder on disk.
 */
export function deleteGroupByFolder(folder: string): void {
  const jids = getRegisteredJidsForFolder(folder);
  if (jids.length === 0) return;

  const placeholders = jids.map(() => '?').join(',');

  db.transaction(() => {
    // Delete messages for all JIDs in this folder
    db.prepare(`DELETE FROM messages WHERE chat_jid IN (${placeholders})`).run(
      ...jids,
    );
    // Delete chats
    db.prepare(`DELETE FROM chats WHERE jid IN (${placeholders})`).run(...jids);
    // Delete scheduled tasks
    db.prepare('DELETE FROM scheduled_tasks WHERE group_folder = ?').run(
      folder,
    );
    // Delete sessions
    db.prepare('DELETE FROM sessions WHERE group_folder = ?').run(folder);
    // Delete registered groups
    db.prepare(
      `DELETE FROM registered_groups WHERE jid IN (${placeholders})`,
    ).run(...jids);
  })();
}

// --- JSON migration ---

function migrateJsonState(): void {
  const migrateFile = (filename: string) => {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      fs.renameSync(filePath, `${filePath}.migrated`);
      return data;
    } catch {
      return null;
    }
  };

  // Migrate router_state.json
  const routerState = migrateFile('router_state.json') as {
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
  } | null;
  if (routerState) {
    if (routerState.last_timestamp) {
      setRouterState('last_timestamp', routerState.last_timestamp);
    }
    if (routerState.last_agent_timestamp) {
      setRouterState(
        'last_agent_timestamp',
        JSON.stringify(routerState.last_agent_timestamp),
      );
    }
  }

  // Migrate sessions.json
  const sessions = migrateFile('sessions.json') as Record<
    string,
    string
  > | null;
  if (sessions) {
    for (const [folder, sessionId] of Object.entries(sessions)) {
      setSession(folder, sessionId);
    }
  }

  // Migrate registered_groups.json
  const groups = migrateFile('registered_groups.json') as Record<
    string,
    RegisteredGroup
  > | null;
  if (groups) {
    for (const [jid, group] of Object.entries(groups)) {
      try {
        setRegisteredGroup(jid, group);
      } catch (err) {
        logger.warn(
          { jid, folder: group.folder, err },
          'Skipping migrated registered group with invalid folder',
        );
      }
    }
  }
}
