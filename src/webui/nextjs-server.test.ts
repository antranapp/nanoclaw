import http from 'http';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';

import { WebChannel } from '../channels/web.js';

vi.mock('../db.js', () => ({
  getRegisteredChats: vi.fn(() => []),
  getRecentMessages: vi.fn(() => []),
  getAllTasks: vi.fn(() => []),
  getTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getAllRegisteredGroups: vi.fn(() => ({})),
}));

vi.mock('../config.js', () => ({
  TIMEZONE: 'America/New_York',
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { startApiServer, type WebUiServer } from './nextjs-server.js';
import * as db from '../db.js';

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      agent: false, // disable keep-alive to avoid stale connections between tests
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve({ status: res.statusCode!, body: json });
        } catch {
          resolve({ status: res.statusCode!, body: {} });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('nextjs-server API', () => {
  let server: WebUiServer;
  let channel: WebChannel;
  const PORT = 14317; // high port to avoid conflicts

  beforeEach(async () => {
    vi.clearAllMocks();

    channel = new WebChannel({
      assistantName: 'TestBot',
      onMessage: vi.fn(),
      onChatMetadata: vi.fn(),
    });
    await channel.connect();

    server = await startApiServer({
      channel,
      assistantName: 'TestBot',
      chatJid: 'web:main',
      host: '127.0.0.1',
      port: PORT,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  // --- GET /api/bootstrap ---

  it('GET /api/bootstrap returns initial state', async () => {
    vi.mocked(db.getRecentMessages).mockReturnValue([]);
    vi.mocked(db.getRegisteredChats).mockReturnValue([]);

    const res = await httpRequest(PORT, 'GET', '/api/bootstrap');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        assistantName: 'TestBot',
        chatJid: 'web:main',
        messages: [],
        chats: [],
        serverTimezone: 'America/New_York',
      }),
    );
    expect(db.getRecentMessages).toHaveBeenCalledWith('web:main', 200);
    expect(db.getRegisteredChats).toHaveBeenCalled();
  });

  // --- POST /api/messages ---

  it('POST /api/messages ingests a user message', async () => {
    const res = await httpRequest(PORT, 'POST', '/api/messages', {
      content: 'Hello bot',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /api/messages with explicit chatJid', async () => {
    const events: unknown[] = [];
    channel.subscribe((e) => events.push(e));

    const res = await httpRequest(PORT, 'POST', '/api/messages', {
      content: 'Hi there',
      chatJid: 'web:custom',
    });

    expect(res.status).toBe(200);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          chat_jid: 'web:custom',
          content: 'Hi there',
        }),
      }),
    ]);
  });

  it('POST /api/messages rejects empty content', async () => {
    const res = await httpRequest(PORT, 'POST', '/api/messages', {
      content: '   ',
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'content required' });
  });

  it('POST /api/messages rejects missing content', async () => {
    const res = await httpRequest(PORT, 'POST', '/api/messages', {});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'content required' });
  });

  // --- GET /api/chats/:jid/messages ---

  it('GET /api/chats/:jid/messages returns message history', async () => {
    const fakeMessages = [
      { id: '1', chat_jid: 'web:main', content: 'msg1', timestamp: '2026-01-01T00:00:00Z' },
    ];
    vi.mocked(db.getRecentMessages).mockReturnValue(fakeMessages as any);

    const encodedJid = encodeURIComponent('web:main');
    const res = await httpRequest(PORT, 'GET', `/api/chats/${encodedJid}/messages`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: fakeMessages });
    expect(db.getRecentMessages).toHaveBeenCalledWith('web:main', 200);
  });

  // --- GET /api/tasks ---

  it('GET /api/tasks returns all tasks', async () => {
    const fakeTasks = [{ id: 'task-1', prompt: 'test' }];
    vi.mocked(db.getAllTasks).mockReturnValue(fakeTasks as any);

    const res = await httpRequest(PORT, 'GET', '/api/tasks');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tasks: fakeTasks });
  });

  // --- POST /api/tasks ---

  it('POST /api/tasks creates a new task', async () => {
    const createdTask = {
      id: 'uuid-1',
      prompt: 'remind me',
      schedule_type: 'once',
      schedule_value: '2026-12-25T00:00:00.000Z',
      status: 'active',
    };
    vi.mocked(db.getTaskById).mockReturnValue(createdTask as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks', {
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'remind me',
      schedule_type: 'once',
      schedule_value: '2026-12-25T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(db.createTask).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ task: createdTask });
  });

  // --- PUT /api/tasks/:id ---

  it('PUT /api/tasks/:id updates an existing task', async () => {
    const existing = {
      id: 'task-1',
      prompt: 'old prompt',
      schedule_type: 'once',
      schedule_value: '2026-06-01T00:00:00Z',
      timezone: 'America/New_York',
    };
    vi.mocked(db.getTaskById).mockReturnValue(existing as any);

    const res = await httpRequest(PORT, 'PUT', '/api/tasks/task-1', {
      prompt: 'new prompt',
    });

    expect(res.status).toBe(200);
    expect(db.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({ prompt: 'new prompt' }));
  });

  it('PUT /api/tasks/:id returns 404 for missing task', async () => {
    vi.mocked(db.getTaskById).mockReturnValue(undefined);

    const res = await httpRequest(PORT, 'PUT', '/api/tasks/nonexistent', {
      prompt: 'x',
    });

    expect(res.status).toBe(404);
  });

  // --- DELETE /api/tasks/:id ---

  it('DELETE /api/tasks/:id deletes a task', async () => {
    vi.mocked(db.getTaskById).mockReturnValue({ id: 'task-1' } as any);

    const res = await httpRequest(PORT, 'DELETE', '/api/tasks/task-1');

    expect(res.status).toBe(200);
    expect(db.deleteTask).toHaveBeenCalledWith('task-1');
  });

  it('DELETE /api/tasks/:id returns 404 for missing task', async () => {
    vi.mocked(db.getTaskById).mockReturnValue(undefined);

    const res = await httpRequest(PORT, 'DELETE', '/api/tasks/nonexistent');

    expect(res.status).toBe(404);
  });

  // --- POST /api/tasks/:id/pause ---

  it('POST /api/tasks/:id/pause pauses a task', async () => {
    const task = { id: 'task-1', status: 'active' };
    vi.mocked(db.getTaskById).mockReturnValue(task as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks/task-1/pause');

    expect(res.status).toBe(200);
    expect(db.updateTask).toHaveBeenCalledWith('task-1', { status: 'paused' });
  });

  it('POST /api/tasks/:id/pause returns 404 for missing task', async () => {
    vi.mocked(db.getTaskById).mockReturnValue(undefined);

    const res = await httpRequest(PORT, 'POST', '/api/tasks/nonexistent/pause');

    expect(res.status).toBe(404);
  });

  // --- POST /api/tasks/:id/resume ---

  it('POST /api/tasks/:id/resume resumes a task', async () => {
    const task = {
      id: 'task-1',
      status: 'paused',
      schedule_type: 'once',
      schedule_value: '2026-12-25T00:00:00.000Z',
      timezone: 'America/New_York',
    };
    vi.mocked(db.getTaskById).mockReturnValue(task as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks/task-1/resume');

    expect(res.status).toBe(200);
    expect(db.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('POST /api/tasks/:id/resume returns 404 for missing task', async () => {
    vi.mocked(db.getTaskById).mockReturnValue(undefined);

    const res = await httpRequest(PORT, 'POST', '/api/tasks/nonexistent/resume');

    expect(res.status).toBe(404);
  });

  // --- GET /api/groups ---

  it('GET /api/groups returns registered groups', async () => {
    vi.mocked(db.getAllRegisteredGroups).mockReturnValue({
      'web:main': {
        name: 'Main',
        folder: 'main',
        trigger: '@Andy',
        added_at: '2026-01-01T00:00:00Z',
      },
    });

    const res = await httpRequest(PORT, 'GET', '/api/groups');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      groups: [{ jid: 'web:main', name: 'Main', folder: 'main' }],
    });
  });

  // --- 404 for unknown routes ---

  it('returns 404 for unknown API routes in API-only mode', async () => {
    const res = await httpRequest(PORT, 'GET', '/unknown-route');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  // --- WebSocket ---

  it('WebSocket receives channel events', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // Trigger a channel event
    await channel.sendMessage('web:main', 'Hello from bot');

    // Wait for WebSocket delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({
          content: 'Hello from bot',
          is_bot_message: true,
        }),
      }),
    ]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket responds to ping with pong', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send(JSON.stringify({ type: 'ping' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toEqual([{ type: 'pong' }]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket send_message ingests user message', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const events: unknown[] = [];
    channel.subscribe((e) => events.push(e));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send(JSON.stringify({ type: 'send_message', content: 'Hi via WS' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          message: expect.objectContaining({
            content: 'Hi via WS',
            chat_jid: 'web:main',
          }),
        }),
      ]),
    );

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket send_message with custom chatJid', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const events: unknown[] = [];
    channel.subscribe((e) => events.push(e));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send(JSON.stringify({ type: 'send_message', content: 'Hi custom', chatJid: 'web:other' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'message',
          message: expect.objectContaining({
            content: 'Hi custom',
            chat_jid: 'web:other',
          }),
        }),
      ]),
    );

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket ignores empty send_message content', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const events: unknown[] = [];
    channel.subscribe((e) => events.push(e));

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.send(JSON.stringify({ type: 'send_message', content: '   ' }));

    await new Promise((r) => setTimeout(r, 50));

    // Only typing or similar events — no message event
    const messageEvents = events.filter((e: any) => e.type === 'message');
    expect(messageEvents).toHaveLength(0);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket sends error on invalid JSON', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.send('not json at all');

    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toEqual([{ type: 'error', message: 'Invalid payload' }]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket forwards typing events', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);
    const messages: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await channel.setTyping('web:main', true);

    await new Promise((r) => setTimeout(r, 50));

    expect(messages).toEqual([
      { type: 'typing', chatJid: 'web:main', isTyping: true },
    ]);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('WebSocket cleans up on close', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    ws.close();
    await new Promise((r) => setTimeout(r, 50));

    // After client closes, sending a channel event shouldn't throw
    await channel.sendMessage('web:main', 'After close');
    // If we get here without error, the cleanup worked
  });

  // --- Task creation with different schedule types ---

  it('POST /api/tasks with cron schedule calculates next_run', async () => {
    vi.mocked(db.getTaskById).mockReturnValue({
      id: 'uuid-1',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
      next_run: '2026-02-24T14:00:00.000Z',
    } as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks', {
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'daily check',
      schedule_type: 'cron',
      schedule_value: '0 9 * * *',
    });

    expect(res.status).toBe(201);
    expect(db.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        next_run: expect.any(String),
      }),
    );
  });

  it('POST /api/tasks with interval schedule calculates next_run', async () => {
    vi.mocked(db.getTaskById).mockReturnValue({
      id: 'uuid-1',
      schedule_type: 'interval',
      schedule_value: '3600000',
    } as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks', {
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'hourly check',
      schedule_type: 'interval',
      schedule_value: '3600000',
    });

    expect(res.status).toBe(201);
    expect(db.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule_type: 'interval',
        next_run: expect.any(String),
      }),
    );
    // Verify the next_run is approximately 1 hour from now
    const createCall = vi.mocked(db.createTask).mock.calls[0][0] as any;
    const nextRunTime = new Date(createCall.next_run).getTime();
    const expectedTime = Date.now() + 3600000;
    expect(Math.abs(nextRunTime - expectedTime)).toBeLessThan(5000);
  });

  it('POST /api/tasks with once schedule uses value as next_run', async () => {
    vi.mocked(db.getTaskById).mockReturnValue({
      id: 'uuid-1',
      schedule_type: 'once',
      schedule_value: '2026-12-25T00:00:00.000Z',
    } as any);

    const res = await httpRequest(PORT, 'POST', '/api/tasks', {
      group_folder: 'main',
      chat_jid: 'web:main',
      prompt: 'christmas task',
      schedule_type: 'once',
      schedule_value: '2026-12-25T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    expect(db.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        next_run: '2026-12-25T00:00:00.000Z',
      }),
    );
  });

  it('PUT /api/tasks/:id recalculates next_run when schedule changes', async () => {
    vi.mocked(db.getTaskById).mockReturnValue({
      id: 'task-1',
      schedule_type: 'once',
      schedule_value: '2026-06-01T00:00:00Z',
      timezone: 'America/New_York',
    } as any);

    const res = await httpRequest(PORT, 'PUT', '/api/tasks/task-1', {
      schedule_type: 'interval',
      schedule_value: '60000',
    });

    expect(res.status).toBe(200);
    expect(db.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        schedule_type: 'interval',
        schedule_value: '60000',
        next_run: expect.any(String),
      }),
    );
  });
});
