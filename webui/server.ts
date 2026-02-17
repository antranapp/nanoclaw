import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { getBridge } from './lib/bridge.js';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '127.0.0.1';
const port = parseInt(process.env.PORT ?? '4317', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request', err);
      res.writeHead(500).end('Internal server error');
    }
  });

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

    const bridge = getBridge();

    // Subscribe to events from the main process
    const unsubscribe = bridge.subscribe((event) => {
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
          const chatJid = frame.chatJid ?? bridge.chatJid;
          if (!content) return;
          await bridge.ingestUserMessage(chatJid, content, 'You');
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

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
