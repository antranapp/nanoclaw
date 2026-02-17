import { createServer } from 'http';
import { parse } from 'url';
import path from 'path';
import { createRequire } from 'module';
import { WebSocketServer, WebSocket } from 'ws';

import type { WebChannel } from '../channels/web.js';
import type { WebUiServer } from './server.js';
import { getAllChats, getRecentMessages } from '../db.js';
import { logger } from '../logger.js';

// Set bridge on globalThis directly — the bridge module in webui/ reads from
// the same globalThis key, avoiding a cross-rootDir import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setBridgeGlobal(bridge: Record<string, unknown>): void {
  (globalThis as any).__nanoclawBridge = bridge;
}

export interface NextJsServerOpts {
  channel: WebChannel;
  assistantName: string;
  chatJid: string;
  host: string;
  port: number;
}

export async function startNextJsServer(opts: NextJsServerOpts): Promise<WebUiServer> {
  const webuiDir = path.resolve(process.cwd(), 'webui');

  // Set up the in-process bridge so Next.js API routes can access channel data.
  // Uses globalThis directly to avoid importing from webui/ (different rootDir).
  setBridgeGlobal({
    assistantName: opts.assistantName,
    chatJid: opts.chatJid,
    ingestUserMessage: (chatJid: string, content: string, senderName?: string) =>
      opts.channel.ingestUserMessage(chatJid, content, senderName),
    getRecentMessages: (chatJid: string, limit: number) => getRecentMessages(chatJid, limit),
    getAllChats: () => getAllChats(),
    subscribe: (listener: (event: unknown) => void) => opts.channel.subscribe(listener as Parameters<WebChannel['subscribe']>[0]),
  });

  // Load Next.js from webui's node_modules (avoids installing next in root)
  const webuiRequire = createRequire(path.join(webuiDir, 'package.json'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nextMod = webuiRequire('next') as any;
  const nextFactory = typeof nextMod === 'function' ? nextMod : nextMod.default;

  const dev = process.env.NODE_ENV !== 'production';
  const app = nextFactory({ dev, dir: webuiDir, hostname: opts.host, port: opts.port });
  const handle = app.getRequestHandler();
  await app.prepare();

  // HTTP server delegates to Next.js
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      logger.error({ err }, 'Next.js request error');
      res.writeHead(500).end('Internal server error');
    }
  });

  // WebSocket server — uses opts.channel directly (same process)
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url ?? '');
    if (pathname !== '/api/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws);
    });
  });

  wss.on('connection', (ws) => {
    sockets.add(ws);

    const unsubscribe = opts.channel.subscribe((event) => {
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
    },
  };
}
