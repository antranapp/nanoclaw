import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

import { CronExpressionParser } from 'cron-parser';
import { randomUUID } from 'crypto';

import type { WebChannel, WebChannelEvent } from '../channels/web.js';
import { TIMEZONE } from '../config.js';
import {
  getRegisteredChats,
  getRecentMessages,
  getAllTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getAllRegisteredGroups,
} from '../db.js';
import { logger } from '../logger.js';

export interface WebUiServer {
  url: string;
  close(): Promise<void>;
}

export interface ApiServerOpts {
  channel: WebChannel;
  assistantName: string;
  chatJid: string;
  host: string;
  port: number;
}

export interface NextJsServerOpts extends ApiServerOpts {}

/**
 * Starts only the HTTP API + WebSocket server with no frontend.
 * Use this when you want to run the React frontend separately via `npm run webui:dev`.
 *
 * Port layout:
 *   opts.port  → API + WebSocket (this server)
 *   4319       → Next.js dev server started by `npm run webui:dev`
 */
export async function startApiServer(opts: ApiServerOpts): Promise<WebUiServer> {
  const { server, wss, sockets } = createApiHttpServer(opts, null);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://${opts.host}:${opts.port}`;
  logger.info({ url }, 'Web UI API server started (frontend: npm run webui:dev)');

  return {
    url,
    async close(): Promise<void> {
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

/**
 * Starts a composite server:
 * - opts.port      → HTTP API + WebSocket + proxy to Next.js UI
 * - opts.port + 1  → Next.js dev server (internal, spawned here)
 *
 * Use this when you want a single command that runs everything.
 */
export async function startNextJsServer(opts: NextJsServerOpts): Promise<WebUiServer> {
  const webuiDir = path.resolve(process.cwd(), 'webui');
  const nextPort = opts.port + 1;

  // Spawn Next.js dev server
  const nextProcess = spawn('npx', ['next', 'dev', '--port', String(nextPort), '--hostname', opts.host], {
    cwd: webuiDir,
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nextProcess.stderr?.on('data', (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) logger.debug({ source: 'nextjs' }, msg);
  });

  await waitForNextJs(opts.host, nextPort, nextProcess);

  const { server, wss, sockets } = createApiHttpServer(opts, nextPort);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://${opts.host}:${opts.port}`;
  logger.info({ url }, 'Next.js Web UI server started');

  return {
    url,
    async close(): Promise<void> {
      for (const ws of sockets) {
        try { ws.close(); } catch { /* ignore */ }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      nextProcess.kill();
      await new Promise<void>((resolve) => nextProcess.once('exit', resolve));
    },
  };
}

// --- Shared API server builder ---

/**
 * Creates the HTTP + WebSocket server that handles all API routes.
 * Pass `nextPort` to also proxy non-API requests to a Next.js instance,
 * or `null` to return 404 for non-API routes (API-only mode).
 */
function createApiHttpServer(
  opts: ApiServerOpts,
  nextPort: number | null,
): { server: http.Server; wss: WebSocketServer; sockets: Set<WebSocket> } {
  const sockets = new Set<WebSocket>();

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        return sendJson(res, 200, {
          assistantName: opts.assistantName,
          chatJid: opts.chatJid,
          messages: getRecentMessages(opts.chatJid, 200),
          chats: getRegisteredChats(),
          serverTimezone: TIMEZONE,
        });
      }

      if (pathname === '/api/messages' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const content = typeof body.content === 'string' ? body.content.trim() : '';
        const chatJid = typeof body.chatJid === 'string' ? body.chatJid : opts.chatJid;
        if (!content) return sendJson(res, 400, { error: 'content required' });
        await opts.channel.ingestUserMessage(chatJid, content, 'You');
        return sendJson(res, 200, { ok: true });
      }

      if (pathname?.startsWith('/api/chats/') && pathname.endsWith('/messages') && req.method === 'GET') {
        const parts = pathname.split('/');
        const jid = decodeURIComponent(parts[3]);
        const messages = getRecentMessages(jid, 200);
        return sendJson(res, 200, { messages });
      }

      if (pathname === '/api/tasks' && req.method === 'GET') {
        return sendJson(res, 200, { tasks: getAllTasks() });
      }

      if (pathname === '/api/tasks' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const id = randomUUID();
        const now = new Date().toISOString();
        const scheduleType = body.schedule_type as string;
        const scheduleValue = body.schedule_value as string;
        const timezone = (body.timezone as string) || TIMEZONE;
        const nextRun = calculateNextRun(scheduleType, scheduleValue, timezone);

        createTask({
          id,
          group_folder: body.group_folder as string,
          chat_jid: body.chat_jid as string,
          prompt: body.prompt as string,
          schedule_type: scheduleType as 'cron' | 'interval' | 'once',
          schedule_value: scheduleValue,
          context_mode: (body.context_mode as 'group' | 'isolated') || 'isolated',
          timezone,
          next_run: nextRun,
          status: (body.status as 'active' | 'paused') || 'active',
          created_at: now,
        });
        return sendJson(res, 201, { task: getTaskById(id) });
      }

      const taskPutMatch = pathname?.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskPutMatch && req.method === 'PUT') {
        const id = decodeURIComponent(taskPutMatch[1]);
        const existing = getTaskById(id);
        if (!existing) return sendJson(res, 404, { error: 'Task not found' });

        const body = await readJsonBody(req);
        const updates: Record<string, unknown> = {};

        for (const key of ['prompt', 'schedule_type', 'schedule_value', 'context_mode', 'timezone', 'group_folder', 'chat_jid', 'status'] as const) {
          if (body[key] !== undefined) updates[key] = body[key];
        }

        const newType = (updates.schedule_type as string) || existing.schedule_type;
        const newValue = (updates.schedule_value as string) || existing.schedule_value;
        const tz = (updates.timezone as string) || existing.timezone || TIMEZONE;
        if (updates.schedule_type !== undefined || updates.schedule_value !== undefined) {
          updates.next_run = calculateNextRun(newType, newValue, tz);
        }

        updateTask(id, updates);
        return sendJson(res, 200, { task: getTaskById(id) });
      }

      const taskDeleteMatch = pathname?.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskDeleteMatch && req.method === 'DELETE') {
        const id = decodeURIComponent(taskDeleteMatch[1]);
        const existing = getTaskById(id);
        if (!existing) return sendJson(res, 404, { error: 'Task not found' });
        deleteTask(id);
        return sendJson(res, 200, { ok: true });
      }

      const taskPauseMatch = pathname?.match(/^\/api\/tasks\/([^/]+)\/pause$/);
      if (taskPauseMatch && req.method === 'POST') {
        const id = decodeURIComponent(taskPauseMatch[1]);
        const existing = getTaskById(id);
        if (!existing) return sendJson(res, 404, { error: 'Task not found' });
        updateTask(id, { status: 'paused' });
        return sendJson(res, 200, { task: getTaskById(id) });
      }

      const taskResumeMatch = pathname?.match(/^\/api\/tasks\/([^/]+)\/resume$/);
      if (taskResumeMatch && req.method === 'POST') {
        const id = decodeURIComponent(taskResumeMatch[1]);
        const existing = getTaskById(id);
        if (!existing) return sendJson(res, 404, { error: 'Task not found' });
        const nextRun = calculateNextRun(existing.schedule_type, existing.schedule_value, existing.timezone || TIMEZONE);
        updateTask(id, { status: 'active', next_run: nextRun });
        return sendJson(res, 200, { task: getTaskById(id) });
      }

      if (pathname === '/api/groups' && req.method === 'GET') {
        const groups = getAllRegisteredGroups();
        const groupList = Object.entries(groups).map(([jid, g]) => ({
          jid,
          name: g.name,
          folder: g.folder,
        }));
        return sendJson(res, 200, { groups: groupList });
      }

      // Non-API request: proxy to Next.js or 404
      if (nextPort !== null) {
        proxyRequest(req, res, opts.host, nextPort);
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      logger.error({ err }, 'Request error');
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/api/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws);
      });
      return;
    }

    if (nextPort !== null) {
      proxyWebSocket(req, socket, head, opts.host, nextPort);
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    sockets.add(ws);

    const unsubscribe = opts.channel.subscribe((event: WebChannelEvent) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (event.type === 'message') {
        ws.send(JSON.stringify({ type: 'message', message: event.message }));
      } else if (event.type === 'typing') {
        ws.send(JSON.stringify({ type: 'typing', chatJid: event.chatJid, isTyping: event.isTyping }));
      }
    });

    ws.on('message', async (raw) => {
      try {
        const frame = JSON.parse(raw.toString()) as { type: string; content?: string; chatJid?: string };
        if (frame.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (frame.type === 'send_message') {
          const content = (frame.content ?? '').trim();
          const chatJid = frame.chatJid ?? opts.chatJid;
          if (!content) return;
          await opts.channel.ingestUserMessage(chatJid, content, 'You');
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid payload' }));
      }
    });

    ws.on('close', () => {
      unsubscribe();
      sockets.delete(ws);
    });

    ws.on('error', (err) => {
      logger.debug({ err: (err as Error).message }, 'WebSocket client error');
      unsubscribe();
      sockets.delete(ws);
    });
  });

  return { server, wss, sockets };
}

// --- Helpers ---

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
}

function proxyRequest(
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  host: string,
  port: number,
): void {
  const proxyReq = http.request(
    { hostname: host, port, method: clientReq.method, path: clientReq.url, headers: clientReq.headers },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(clientRes);
    },
  );
  proxyReq.on('error', (err) => {
    logger.debug({ err }, 'Proxy request error');
    if (!clientRes.headersSent) sendJson(clientRes, 502, { error: 'Next.js proxy error' });
  });
  clientReq.pipe(proxyReq);
}

function proxyWebSocket(
  req: http.IncomingMessage,
  socket: import('stream').Duplex,
  _head: Buffer,
  host: string,
  port: number,
): void {
  const proxyReq = http.request({
    hostname: host,
    port,
    method: 'GET',
    path: req.url,
    headers: req.headers,
  });

  proxyReq.on('upgrade', (_proxyRes, proxySocket, proxyHead) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${_proxyRes.headers['sec-websocket-accept']}\r\n` +
      '\r\n',
    );
    if (proxyHead.length > 0) socket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  socket.on('error', () => proxyReq.destroy());
  proxyReq.end();
}

function calculateNextRun(scheduleType: string, scheduleValue: string, timezone?: string): string | null {
  if (scheduleType === 'cron') {
    const interval = CronExpressionParser.parse(scheduleValue, { tz: timezone || TIMEZONE });
    return interval.next().toISOString();
  }
  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    return new Date(Date.now() + ms).toISOString();
  }
  if (scheduleType === 'once') {
    return scheduleValue;
  }
  return null;
}

async function waitForNextJs(host: string, port: number, proc: ChildProcess): Promise<void> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    if (proc.exitCode !== null) throw new Error('Next.js process exited early');
    const ok = await new Promise<boolean>((resolve) => {
      const req = http.request({ hostname: host, port, path: '/', method: 'HEAD', timeout: 1000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
    if (ok) {
      logger.debug({ port }, 'Next.js dev server ready');
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Next.js dev server did not start on port ${port} within ${maxAttempts * 0.5}s`);
}
