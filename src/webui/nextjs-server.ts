import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

import type { WebChannel, WebChannelEvent } from '../channels/web.js';
import { getRegisteredChats, getRecentMessages } from '../db.js';
import { logger } from '../logger.js';

export interface WebUiServer {
  url: string;
  close(): Promise<void>;
}

export interface NextJsServerOpts {
  channel: WebChannel;
  assistantName: string;
  chatJid: string;
  host: string;
  port: number;
}

/**
 * Starts a composite server:
 * - Port 4317: our HTTP server handling API routes + WebSocket + proxying UI to Next.js
 * - Port 4318: Next.js dev server (internal, UI rendering only)
 *
 * Next.js with Turbopack spawns its own HTTP server during prepare(), so we can't
 * run it in-process on the same port. Instead we proxy UI requests to it.
 */
export async function startNextJsServer(opts: NextJsServerOpts): Promise<WebUiServer> {
  const webuiDir = path.resolve(process.cwd(), 'webui');
  const nextPort = opts.port + 1; // Internal Next.js port

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

  // Wait for Next.js to be ready
  await waitForNextJs(opts.host, nextPort, nextProcess);

  // Create our main HTTP server on the user-facing port
  const sockets = new Set<WebSocket>();

  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

      // Handle API routes directly (data lives in this process)
      if (pathname === '/api/bootstrap' && req.method === 'GET') {
        return sendJson(res, 200, {
          assistantName: opts.assistantName,
          chatJid: opts.chatJid,
          messages: getRecentMessages(opts.chatJid, 200),
          chats: getRegisteredChats(),
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
        // /api/chats/[jid]/messages → parts = ['', 'api', 'chats', jid, 'messages']
        const jid = decodeURIComponent(parts[3]);
        const messages = getRecentMessages(jid, 200);
        return sendJson(res, 200, { messages });
      }

      // Proxy everything else to Next.js
      proxyRequest(req, res, opts.host, nextPort);
    } catch (err) {
      logger.error({ err }, 'Request error');
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/api/ws') {
      // Our WebSocket — real-time channel events
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws);
      });
      return;
    }

    // Proxy HMR WebSocket to Next.js
    proxyWebSocket(req, socket, head, opts.host, nextPort);
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
  });

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
