import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST ?? '127.0.0.1';
const port = parseInt(process.env.PORT ?? '4317', 10);
const backendWsUrl = process.env.BACKEND_WS_URL ?? `ws://127.0.0.1:4317/api/ws`;

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
    // Proxy WebSocket to the backend — works when the backend is started with --webui
    const backendWs = new WebSocket(backendWsUrl);

    backendWs.on('message', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data as Buffer);
    });

    ws.on('message', (data) => {
      if (backendWs.readyState === WebSocket.OPEN) backendWs.send(data as Buffer);
    });

    const cleanup = () => {
      try { backendWs.close(); } catch { /* ignore */ }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);

    backendWs.on('close', () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    backendWs.on('error', (err) => {
      console.error('Backend WS error:', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: 'Backend connection failed. Is the backend running with --webui?' }));
        ws.close();
      }
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
