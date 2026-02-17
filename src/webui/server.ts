import fs from 'fs';
import http from 'http';
import path from 'path';
import { URL } from 'url';

import { WebSocketServer, WebSocket } from 'ws';

import { logger } from '../logger.js';
import { NewMessage } from '../types.js';
import { WebChannel, WebChannelEvent } from '../channels/web.js';

export interface WebUiServerOpts {
  channel: WebChannel;
  assistantName: string;
  chatJid: string;
  host: string;
  port: number;
  getRecentMessages: (chatJid: string, limit: number) => NewMessage[];
}

export interface WebUiServer {
  url: string;
  close(): Promise<void>;
}

interface WsFrame {
  type: string;
  [key: string]: unknown;
}

export async function startWebUiServer(
  opts: WebUiServerOpts,
): Promise<WebUiServer> {
  const webRoot = path.resolve(process.cwd(), 'assets', 'webui');
  const sockets = new Set<WebSocket>();

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendJson(res, 400, { error: 'Missing request URL' });
        return;
      }

      const requestUrl = new URL(req.url, `http://${opts.host}:${opts.port}`);
      const pathname = requestUrl.pathname;

      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/bootstrap') {
        sendJson(res, 200, {
          assistantName: opts.assistantName,
          chatJid: opts.chatJid,
          messages: opts.getRecentMessages(opts.chatJid, 200),
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/messages') {
        const body = await readJsonBody(req);
        const content =
          typeof body.content === 'string' ? body.content.trim() : '';
        if (!content) {
          sendJson(res, 400, { error: 'Message content is required' });
          return;
        }

        await opts.channel.ingestUserMessage(opts.chatJid, content, 'You');
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET') {
        await serveStaticFile(webRoot, pathname, res);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      logger.error({ err }, 'Web UI request failed');
      sendJson(res, 500, { error: 'Internal server error' });
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      if (!req.url) {
        socket.destroy();
        return;
      }
      const requestUrl = new URL(req.url, `http://${opts.host}:${opts.port}`);
      if (requestUrl.pathname !== '/api/ws') {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    sockets.add(ws);

    ws.on('message', async (raw) => {
      try {
        const frame = JSON.parse(raw.toString()) as WsFrame;

        if (frame.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (frame.type === 'send_message') {
          const content =
            typeof frame.content === 'string' ? frame.content.trim() : '';
          if (!content) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Message content is required',
              }),
            );
            return;
          }
          await opts.channel.ingestUserMessage(opts.chatJid, content, 'You');
        }
      } catch {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid WebSocket payload',
          }),
        );
      }
    });

    ws.on('close', () => {
      sockets.delete(ws);
    });
  });

  const unsubscribe = opts.channel.subscribe((event: WebChannelEvent) => {
    if (event.type === 'message' && event.message.chat_jid !== opts.chatJid) {
      return;
    }

    const payload =
      event.type === 'message'
        ? { type: 'message', message: event.message }
        : { type: 'typing', chatJid: event.chatJid, isTyping: event.isTyping };

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const url = `http://${opts.host}:${opts.port}`;
  logger.info({ url }, 'Web UI server started');

  return {
    url,
    async close(): Promise<void> {
      unsubscribe();
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          // Ignore close errors.
        }
      }
      await new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(
  req: http.IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  const body = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(body) as Record<string, unknown>;
}

async function serveStaticFile(
  webRoot: string,
  pathname: string,
  res: http.ServerResponse,
): Promise<void> {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const requested = path.normalize(cleanPath).replace(/^\/+/, '');
  const filePath = path.join(webRoot, requested);
  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(webRoot)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(resolved);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const ext = path.extname(resolved);
  const mime = mimeTypeFor(ext);
  const stream = fs.createReadStream(resolved);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });

  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}

function mimeTypeFor(ext: string): string {
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
