import { describe, it, expect, beforeEach } from 'vitest';

import {
  _initTestDatabase,
  createTask,
  deleteGroupByFolder,
  deleteTask,
  getAllChats,
  getGroupFolders,
  getMessagesSinceForJids,
  getMessagesSince,
  getNewMessages,
  getRecentMessages,
  getRecentMessagesByFolder,
  getRegisteredJidsForFolder,
  getSession,
  getTaskById,
  getTaskRunEvents,
  markTaskRunFinished,
  markTaskRunStarted,
  pruneTaskRunEvents,
  setRegisteredGroup,
  setSession,
  storeChatMetadata,
  storeMessage,
  updateTask,
} from './db.js';
import { RegisteredGroup } from './types.js';

beforeEach(() => {
  _initTestDatabase();
});

// Helper to store a message using the normalized NewMessage interface
function store(overrides: {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
}) {
  storeMessage({
    id: overrides.id,
    chat_jid: overrides.chat_jid,
    sender: overrides.sender,
    sender_name: overrides.sender_name,
    content: overrides.content,
    timestamp: overrides.timestamp,
    is_from_me: overrides.is_from_me ?? false,
  });
}

// --- storeMessage (NewMessage format) ---

describe('storeMessage', () => {
  it('stores a message and retrieves it', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-1',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'hello world',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].sender).toBe('123@s.whatsapp.net');
    expect(messages[0].sender_name).toBe('Alice');
    expect(messages[0].content).toBe('hello world');
  });

  it('filters out empty content', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-2',
      chat_jid: 'group@g.us',
      sender: '111@s.whatsapp.net',
      sender_name: 'Dave',
      content: '',
      timestamp: '2024-01-01T00:00:04.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(0);
  });

  it('stores is_from_me flag', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-3',
      chat_jid: 'group@g.us',
      sender: 'me@s.whatsapp.net',
      sender_name: 'Me',
      content: 'my message',
      timestamp: '2024-01-01T00:00:05.000Z',
      is_from_me: true,
    });

    // Message is stored (we can retrieve it — is_from_me doesn't affect retrieval)
    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
  });

  it('upserts on duplicate id+chat_jid', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'original',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    store({
      id: 'msg-dup',
      chat_jid: 'group@g.us',
      sender: '123@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'updated',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const messages = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('updated');
  });
});

// --- getMessagesSince ---

describe('getMessagesSince', () => {
  beforeEach(() => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'm1',
      chat_jid: 'group@g.us',
      sender: 'Alice@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'first',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'm2',
      chat_jid: 'group@g.us',
      sender: 'Bob@s.whatsapp.net',
      sender_name: 'Bob',
      content: 'second',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'm3',
      chat_jid: 'group@g.us',
      sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot',
      content: 'bot reply',
      timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'm4',
      chat_jid: 'group@g.us',
      sender: 'Carol@s.whatsapp.net',
      sender_name: 'Carol',
      content: 'third',
      timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns messages after the given timestamp', () => {
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Should exclude m1, m2 (before/at timestamp), m3 (bot message)
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('third');
  });

  it('excludes bot messages via is_bot_message flag', () => {
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    const botMsgs = msgs.filter((m) => m.content === 'bot reply');
    expect(botMsgs).toHaveLength(0);
  });

  it('returns all non-bot messages when sinceTimestamp is empty', () => {
    const msgs = getMessagesSince('group@g.us', '', 'Andy');
    // 3 user messages (bot message excluded)
    expect(msgs).toHaveLength(3);
  });

  it('filters pre-migration bot messages via content prefix backstop', () => {
    // Simulate a message written before migration: has prefix but is_bot_message = 0
    store({
      id: 'm5',
      chat_jid: 'group@g.us',
      sender: 'Bot@s.whatsapp.net',
      sender_name: 'Bot',
      content: 'Andy: old bot reply',
      timestamp: '2024-01-01T00:00:05.000Z',
    });
    const msgs = getMessagesSince(
      'group@g.us',
      '2024-01-01T00:00:04.000Z',
      'Andy',
    );
    expect(msgs).toHaveLength(0);
  });
});

// --- getNewMessages ---

describe('getNewMessages', () => {
  beforeEach(() => {
    storeChatMetadata('group1@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group2@g.us', '2024-01-01T00:00:00.000Z');

    store({
      id: 'a1',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g1 msg1',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'a2',
      chat_jid: 'group2@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g2 msg1',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
    storeMessage({
      id: 'a3',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'bot reply',
      timestamp: '2024-01-01T00:00:03.000Z',
      is_bot_message: true,
    });
    store({
      id: 'a4',
      chat_jid: 'group1@g.us',
      sender: 'user@s.whatsapp.net',
      sender_name: 'User',
      content: 'g1 msg2',
      timestamp: '2024-01-01T00:00:04.000Z',
    });
  });

  it('returns new messages across multiple groups', () => {
    const { messages, newTimestamp } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    // Excludes bot message, returns 3 user messages
    expect(messages).toHaveLength(3);
    expect(newTimestamp).toBe('2024-01-01T00:00:04.000Z');
  });

  it('filters by timestamp', () => {
    const { messages } = getNewMessages(
      ['group1@g.us', 'group2@g.us'],
      '2024-01-01T00:00:02.000Z',
      'Andy',
    );
    // Only g1 msg2 (after ts, not bot)
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('g1 msg2');
  });

  it('returns empty for no registered groups', () => {
    const { messages, newTimestamp } = getNewMessages([], '', 'Andy');
    expect(messages).toHaveLength(0);
    expect(newTimestamp).toBe('');
  });
});

describe('folder-bound lookups', () => {
  const MAIN: RegisteredGroup = {
    name: 'Main',
    folder: 'main',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00.000Z',
  };

  it('allows multiple JIDs bound to the same folder', () => {
    setRegisteredGroup('main@s.whatsapp.net', MAIN, 'whatsapp');
    setRegisteredGroup('web:main', MAIN, 'web');

    const jids = getRegisteredJidsForFolder('main').sort();
    expect(jids).toEqual(['main@s.whatsapp.net', 'web:main']);
  });

  it('fetches messages across multiple bound JIDs', () => {
    storeChatMetadata(
      'main@s.whatsapp.net',
      '2024-01-01T00:00:00.000Z',
      'Main WA',
    );
    storeChatMetadata('web:main', '2024-01-01T00:00:00.000Z', 'Main Web');

    store({
      id: 'mw1',
      chat_jid: 'main@s.whatsapp.net',
      sender: '111@s.whatsapp.net',
      sender_name: 'Alice',
      content: 'from wa',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'mw2',
      chat_jid: 'web:main',
      sender: 'user@web',
      sender_name: 'You',
      content: 'from web',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    const msgs = getMessagesSinceForJids(
      ['main@s.whatsapp.net', 'web:main'],
      '2024-01-01T00:00:00.000Z',
      'Andy',
    );
    expect(msgs.map((m) => m.content)).toEqual(['from wa', 'from web']);
  });
});

describe('getRecentMessages', () => {
  it('returns chronologically ordered recent messages', () => {
    storeChatMetadata('web:main', '2024-01-01T00:00:00.000Z', 'Web UI');

    store({
      id: 'r1',
      chat_jid: 'web:main',
      sender: 'user@web',
      sender_name: 'You',
      content: 'first',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'r2',
      chat_jid: 'web:main',
      sender: 'assistant@web',
      sender_name: 'Andy',
      content: 'second',
      timestamp: '2024-01-01T00:00:02.000Z',
      is_from_me: true,
    });

    const recent = getRecentMessages('web:main', 10);
    expect(recent.map((m) => m.id)).toEqual(['r1', 'r2']);
  });
});

// --- storeChatMetadata ---

describe('storeChatMetadata', () => {
  it('stores chat with JID as default name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('group@g.us');
    expect(chats[0].name).toBe('group@g.us');
  });

  it('stores chat with explicit name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z', 'My Group');
    const chats = getAllChats();
    expect(chats[0].name).toBe('My Group');
  });

  it('updates name on subsequent call with name', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:00.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z', 'Updated Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated Name');
  });

  it('preserves newer timestamp on conflict', () => {
    storeChatMetadata('group@g.us', '2024-01-01T00:00:05.000Z');
    storeChatMetadata('group@g.us', '2024-01-01T00:00:01.000Z');
    const chats = getAllChats();
    expect(chats[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });
});

// --- Task CRUD ---

describe('task CRUD', () => {
  it('creates and retrieves a task', () => {
    createTask({
      id: 'task-1',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'do something',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: '2024-06-01T00:00:00.000Z',
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('do something');
    expect(task!.status).toBe('active');
  });

  it('updates task status', () => {
    createTask({
      id: 'task-2',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'test',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    updateTask('task-2', { status: 'paused' });
    expect(getTaskById('task-2')!.status).toBe('paused');
  });

  it('deletes a task and its run logs', () => {
    createTask({
      id: 'task-3',
      group_folder: 'main',
      chat_jid: 'group@g.us',
      prompt: 'delete me',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    deleteTask('task-3');
    expect(getTaskById('task-3')).toBeUndefined();
  });
});

// --- getRecentMessagesByFolder ---

describe('getRecentMessagesByFolder', () => {
  const GROUP: RegisteredGroup = {
    name: 'Test Group',
    folder: 'test-group',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    setRegisteredGroup('wa@g.us', GROUP, 'whatsapp');
    setRegisteredGroup('web:test-group', GROUP, 'web');
    storeChatMetadata('wa@g.us', '2024-01-01T00:00:00.000Z', 'WA');
    storeChatMetadata('web:test-group', '2024-01-01T00:00:00.000Z', 'Web');
  });

  it('returns messages across multiple JIDs for the same folder', () => {
    store({
      id: 'wa1',
      chat_jid: 'wa@g.us',
      sender: 'alice@wa',
      sender_name: 'Alice',
      content: 'from whatsapp',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'web1',
      chat_jid: 'web:test-group',
      sender: 'user@web',
      sender_name: 'You',
      content: 'from web',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    const msgs = getRecentMessagesByFolder('test-group', 100);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('from whatsapp');
    expect(msgs[1].content).toBe('from web');
  });

  it('returns messages in chronological order', () => {
    store({
      id: 'late',
      chat_jid: 'wa@g.us',
      sender: 'alice@wa',
      sender_name: 'Alice',
      content: 'later',
      timestamp: '2024-01-01T00:00:03.000Z',
    });
    store({
      id: 'early',
      chat_jid: 'web:test-group',
      sender: 'user@web',
      sender_name: 'You',
      content: 'earlier',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    const msgs = getRecentMessagesByFolder('test-group', 100);
    expect(msgs[0].content).toBe('earlier');
    expect(msgs[1].content).toBe('later');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      store({
        id: `msg-${i}`,
        chat_jid: 'web:test-group',
        sender: 'user@web',
        sender_name: 'You',
        content: `message ${i}`,
        timestamp: `2024-01-01T00:00:0${i + 1}.000Z`,
      });
    }

    const msgs = getRecentMessagesByFolder('test-group', 3);
    expect(msgs).toHaveLength(3);
    // Should get the latest 3 in chronological order
    expect(msgs[0].content).toBe('message 2');
    expect(msgs[2].content).toBe('message 4');
  });

  it('returns empty array for unknown folder', () => {
    const msgs = getRecentMessagesByFolder('nonexistent', 100);
    expect(msgs).toHaveLength(0);
  });
});

// --- getGroupFolders ---

describe('getGroupFolders', () => {
  it('returns deduplicated group list with web JID detection', () => {
    const main: RegisteredGroup = {
      name: 'Main',
      folder: 'main',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('main@g.us', main, 'whatsapp');
    setRegisteredGroup('web:main', main, 'web');

    const folders = getGroupFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toEqual({
      name: 'Main',
      folder: 'main',
      webJid: 'web:main',
    });
  });

  it('returns null webJid when no web JID exists', () => {
    const group: RegisteredGroup = {
      name: 'WA Only',
      folder: 'wa-only',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('wa-only@g.us', group, 'whatsapp');

    const folders = getGroupFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0].webJid).toBeNull();
  });

  it('returns multiple folders sorted', () => {
    const alpha: RegisteredGroup = {
      name: 'Alpha',
      folder: 'alpha',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    const beta: RegisteredGroup = {
      name: 'Beta',
      folder: 'beta',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('web:alpha', alpha, 'web');
    setRegisteredGroup('web:beta', beta, 'web');

    const folders = getGroupFolders();
    expect(folders).toHaveLength(2);
    expect(folders.map((f) => f.folder)).toEqual(['alpha', 'beta']);
  });

  it('returns empty array when no groups registered', () => {
    const folders = getGroupFolders();
    expect(folders).toHaveLength(0);
  });
});

// --- deleteGroupByFolder ---

describe('deleteGroupByFolder', () => {
  const GROUP: RegisteredGroup = {
    name: 'Doomed',
    folder: 'doomed',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    setRegisteredGroup('wa@g.us', GROUP, 'whatsapp');
    setRegisteredGroup('web:doomed', GROUP, 'web');
    storeChatMetadata('wa@g.us', '2024-01-01T00:00:00.000Z', 'WA');
    storeChatMetadata('web:doomed', '2024-01-01T00:00:00.000Z', 'Web');

    store({
      id: 'msg1',
      chat_jid: 'wa@g.us',
      sender: 'alice@wa',
      sender_name: 'Alice',
      content: 'hello',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
    store({
      id: 'msg2',
      chat_jid: 'web:doomed',
      sender: 'user@web',
      sender_name: 'You',
      content: 'hi',
      timestamp: '2024-01-01T00:00:02.000Z',
    });

    createTask({
      id: 'task-doom',
      group_folder: 'doomed',
      chat_jid: 'wa@g.us',
      prompt: 'doomed task',
      schedule_type: 'once',
      schedule_value: '2024-06-01T00:00:00.000Z',
      context_mode: 'isolated',
      next_run: null,
      status: 'active',
      created_at: '2024-01-01T00:00:00.000Z',
    });

    setSession('doomed', 'session-123');
  });

  it('deletes all data for the folder', () => {
    deleteGroupByFolder('doomed');

    // Registered groups removed
    expect(getRegisteredJidsForFolder('doomed')).toHaveLength(0);

    // Messages removed
    expect(getRecentMessages('wa@g.us', 100)).toHaveLength(0);
    expect(getRecentMessages('web:doomed', 100)).toHaveLength(0);

    // Chats removed
    const chats = getAllChats();
    expect(chats.find((c) => c.jid === 'wa@g.us')).toBeUndefined();
    expect(chats.find((c) => c.jid === 'web:doomed')).toBeUndefined();

    // Task removed
    expect(getTaskById('task-doom')).toBeUndefined();

    // Session removed
    expect(getSession('doomed')).toBeUndefined();
  });

  it('does nothing for non-existent folder', () => {
    // Should not throw
    deleteGroupByFolder('nonexistent');
  });

  it('does not affect other groups', () => {
    const other: RegisteredGroup = {
      name: 'Safe',
      folder: 'safe',
      trigger: '@Andy',
      added_at: '2024-01-01T00:00:00.000Z',
    };
    setRegisteredGroup('web:safe', other, 'web');
    storeChatMetadata('web:safe', '2024-01-01T00:00:00.000Z', 'Safe');
    store({
      id: 'safe-msg',
      chat_jid: 'web:safe',
      sender: 'user@web',
      sender_name: 'You',
      content: 'safe message',
      timestamp: '2024-01-01T00:00:01.000Z',
    });

    deleteGroupByFolder('doomed');

    expect(getRegisteredJidsForFolder('safe')).toHaveLength(1);
    expect(getRecentMessages('web:safe', 100)).toHaveLength(1);
  });
});

// --- Task run events ---

function createTestTask(id: string) {
  createTask({
    id,
    group_folder: 'main',
    chat_jid: 'group@g.us',
    prompt: 'test task',
    schedule_type: 'once',
    schedule_value: '2024-06-01T00:00:00.000Z',
    context_mode: 'isolated',
    next_run: '2024-06-01T00:00:00.000Z',
    status: 'active',
    created_at: '2024-01-01T00:00:00.000Z',
  });
}

describe('markTaskRunStarted', () => {
  it('sets run_state to running and records start event', () => {
    createTestTask('task-rs-1');

    markTaskRunStarted('task-rs-1', 'run-001', '2024-06-01T00:00:00.000Z');

    const task = getTaskById('task-rs-1');
    expect(task!.run_state).toBe('running');
    expect(task!.current_run_id).toBe('run-001');
    expect(task!.run_started_at).toBe('2024-06-01T00:00:00.000Z');

    const events = getTaskRunEvents('task-rs-1');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('start');
    expect(events[0].run_id).toBe('run-001');
  });
});

describe('markTaskRunFinished', () => {
  it('resets run_state to idle and records finish event on success', () => {
    createTestTask('task-rf-1');
    markTaskRunStarted('task-rf-1', 'run-002', '2024-06-01T00:00:00.000Z');

    markTaskRunFinished(
      'task-rf-1', 'run-002', '2024-06-01T00:01:00.000Z',
      60000, 'success', null, 'all good', null,
    );

    const task = getTaskById('task-rf-1');
    expect(task!.run_state).toBe('idle');
    expect(task!.current_run_id).toBeNull();
    expect(task!.run_started_at).toBeNull();
    expect(task!.last_run_status).toBe('success');
    expect(task!.last_error).toBeNull();
    expect(task!.last_duration_ms).toBe(60000);
    // once task with null nextRun should be completed
    expect(task!.status).toBe('completed');
  });

  it('records error status and last_error on failure', () => {
    createTestTask('task-rf-2');
    markTaskRunStarted('task-rf-2', 'run-003', '2024-06-01T00:00:00.000Z');

    markTaskRunFinished(
      'task-rf-2', 'run-003', '2024-06-01T00:00:30.000Z',
      30000, 'error', '2024-06-02T00:00:00.000Z', null, 'something broke',
    );

    const task = getTaskById('task-rf-2');
    expect(task!.run_state).toBe('idle');
    expect(task!.last_run_status).toBe('error');
    expect(task!.last_error).toBe('something broke');
    expect(task!.last_duration_ms).toBe(30000);
    // has nextRun so should still be active
    expect(task!.status).toBe('active');
  });
});

describe('getTaskRunEvents', () => {
  it('returns events in descending order with correct limit', () => {
    createTestTask('task-ev-1');

    markTaskRunStarted('task-ev-1', 'run-a', '2024-06-01T00:00:00.000Z');
    markTaskRunFinished('task-ev-1', 'run-a', '2024-06-01T00:01:00.000Z', 60000, 'success', null, 'ok', null);
    markTaskRunStarted('task-ev-1', 'run-b', '2024-06-01T00:02:00.000Z');
    markTaskRunFinished('task-ev-1', 'run-b', '2024-06-01T00:03:00.000Z', 60000, 'success', null, 'ok', null);

    // All events
    const all = getTaskRunEvents('task-ev-1', 100);
    expect(all).toHaveLength(4);
    // Descending order
    expect(all[0].event_at >= all[1].event_at).toBe(true);

    // Limited
    const limited = getTaskRunEvents('task-ev-1', 2);
    expect(limited).toHaveLength(2);
  });
});

describe('pruneTaskRunEvents', () => {
  it('keeps only the specified number of most recent runs', () => {
    createTestTask('task-pr-1');

    // Create 3 runs
    for (let i = 0; i < 3; i++) {
      const runId = `run-${String(i).padStart(3, '0')}`;
      const startAt = `2024-06-01T0${i}:00:00.000Z`;
      const endAt = `2024-06-01T0${i}:01:00.000Z`;
      markTaskRunStarted('task-pr-1', runId, startAt);
      markTaskRunFinished('task-pr-1', runId, endAt, 60000, 'success', null, 'ok', null);
    }

    // Should have 6 events (3 runs * 2 events each)
    expect(getTaskRunEvents('task-pr-1', 100)).toHaveLength(6);

    // Prune to keep only 2 runs
    pruneTaskRunEvents('task-pr-1', 2);

    const remaining = getTaskRunEvents('task-pr-1', 100);
    // Should have 4 events (2 runs * 2 events each)
    expect(remaining).toHaveLength(4);
  });
});

describe('deleteTask with run events', () => {
  it('also removes task_run_events', () => {
    createTestTask('task-del-1');
    markTaskRunStarted('task-del-1', 'run-del', '2024-06-01T00:00:00.000Z');
    markTaskRunFinished('task-del-1', 'run-del', '2024-06-01T00:01:00.000Z', 60000, 'success', null, 'ok', null);

    expect(getTaskRunEvents('task-del-1', 100)).toHaveLength(2);

    deleteTask('task-del-1');

    expect(getTaskById('task-del-1')).toBeUndefined();
    expect(getTaskRunEvents('task-del-1', 100)).toHaveLength(0);
  });
});
