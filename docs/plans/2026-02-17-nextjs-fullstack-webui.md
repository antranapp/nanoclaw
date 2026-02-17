# Full-Stack Next.js Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `src/webui/server.ts` and `assets/webui/` with a full-stack Next.js app in `webui/` that handles both the API (Bootstrap, Messages, WebSocket) and a two-column React UI with shadcn/ui components and markdown rendering.

**Architecture:** Next.js 15 App Router runs on port `4317` (same as current `WEBUI_PORT`). API Routes replace the hand-rolled HTTP server. The existing `WebChannel` in `src/channels/web.ts` and all orchestration in `src/index.ts` remain unchanged — Next.js is wired in as a drop-in replacement for the old server. A singleton module bridges the running WebChannel instance to the Next.js API routes via an in-process event bus.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui (Button, Input, Badge, ScrollArea, Separator), `react-markdown` + `remark-gfm` for markdown, `ws` for WebSocket server

---

## Task 1: Scaffold Next.js App

**Files:**
- Create: `webui/` directory with Next.js scaffold

**Step 1: Scaffold with create-next-app (no git, no src dir)**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
npx create-next-app@latest webui \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --no-git \
  --yes
```

Expected: `webui/` created with `app/`, `public/`, `package.json`, `next.config.ts`, `tsconfig.json`

**Step 2: Install shadcn/ui**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npx shadcn@latest init --yes --defaults
```

Expected: `components/ui/` created, `components.json` written

**Step 3: Add shadcn components**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npx shadcn@latest add button input badge scroll-area separator
```

Expected: Components added to `components/ui/`

**Step 4: Install markdown and WebSocket packages**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npm install react-markdown remark-gfm ws
npm install --save-dev @types/ws
```

**Step 5: Add dev script to root package.json**

Edit `/Users/antran/Projects/OpenSource/nanoclaw/package.json`, add to `scripts`:

```json
"webui:dev": "cd webui && npm run dev -- --port 4317"
```

**Step 6: Add webui to root .gitignore**

Append to `/Users/antran/Projects/OpenSource/nanoclaw/.gitignore`:

```
webui/.next/
webui/node_modules/
```

**Step 7: Verify scaffold starts**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui && npm run dev -- --port 4317
```

Expected: "Ready" message at http://localhost:4317. Stop with Ctrl+C.

**Step 8: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/ package.json .gitignore
git commit -m "chore: scaffold Next.js fullstack webui with shadcn/ui"
```

---

## Task 2: In-Process Bridge (WebChannel ↔ Next.js)

The key architectural challenge: Next.js API routes need to call into `WebChannel` (which lives in the main process), and `WebChannel` events need to reach WebSocket clients connected to Next.js. We solve this with a singleton bridge module that both sides import.

**Files:**
- Create: `webui/lib/bridge.ts`
- Modify: `src/webui/server.ts` → will be replaced in Task 5, but for now we create the bridge

**Step 1: Create the bridge singleton**

Create `webui/lib/bridge.ts`:

```typescript
import type { NewMessage } from '../../src/types.js';

export type WebChannelEvent =
  | { type: 'message'; message: NewMessage }
  | { type: 'typing'; chatJid: string; isTyping: boolean };

export type ChannelBridge = {
  assistantName: string;
  chatJid: string;
  ingestUserMessage(chatJid: string, content: string, senderName?: string): Promise<void>;
  getRecentMessages(chatJid: string, limit: number): NewMessage[];
  getAllChats(): Array<{ jid: string; name: string | null; last_message_time: string }>;
  subscribe(listener: (event: WebChannelEvent) => void): () => void;
};

let _bridge: ChannelBridge | null = null;

export function setBridge(bridge: ChannelBridge): void {
  _bridge = bridge;
}

export function getBridge(): ChannelBridge {
  if (!_bridge) throw new Error('Bridge not initialized — is the backend running with --webui?');
  return _bridge;
}
```

**Step 2: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/lib/bridge.ts
git commit -m "feat(webui): add in-process bridge singleton for WebChannel"
```

---

## Task 3: Next.js API Routes

**Files:**
- Create: `webui/app/api/bootstrap/route.ts`
- Create: `webui/app/api/messages/route.ts`
- Create: `webui/app/api/chats/[jid]/messages/route.ts`

> Note: WebSocket (`/api/ws`) requires a custom Next.js server — handled in Task 5.

**Step 1: Create bootstrap route**

Create `webui/app/api/bootstrap/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function GET() {
  try {
    const bridge = getBridge();
    const messages = bridge.getRecentMessages(bridge.chatJid, 200);
    const chats = bridge.getAllChats();
    return NextResponse.json({
      assistantName: bridge.assistantName,
      chatJid: bridge.chatJid,
      messages,
      chats,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
```

**Step 2: Create messages POST route**

Create `webui/app/api/messages/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { content?: string; chatJid?: string };
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const chatJid = typeof body.chatJid === 'string' ? body.chatJid : getBridge().chatJid;
    if (!content) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }
    await getBridge().ingestUserMessage(chatJid, content, 'You');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
```

**Step 3: Create per-chat messages route**

Create `webui/app/api/chats/[jid]/messages/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jid: string }> },
) {
  try {
    const { jid } = await params;
    const chatJid = decodeURIComponent(jid);
    const messages = getBridge().getRecentMessages(chatJid, 200);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
```

**Step 4: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/app/api/
git commit -m "feat(webui): add Next.js API routes for bootstrap, messages, and chat history"
```

---

## Task 4: React UI — Two-Column Layout

**Files:**
- Modify: `webui/app/globals.css`
- Modify: `webui/app/layout.tsx`
- Create: `webui/components/chat-shell.tsx`
- Create: `webui/components/chat-sidebar.tsx`
- Create: `webui/components/chat-panel.tsx`
- Create: `webui/components/markdown-message.tsx`
- Create: `webui/hooks/use-chat.ts`
- Modify: `webui/app/page.tsx`

**Step 1: Update globals.css**

Replace `webui/app/globals.css`:

```css
@import "tailwindcss";

html, body, #__next {
  height: 100%;
  margin: 0;
}
```

**Step 2: Update layout.tsx**

Replace `webui/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'NanoClaw' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-gradient-to-br from-[#f3ead8] to-[#dfe8f1]">
        {children}
      </body>
    </html>
  );
}
```

**Step 3: Create the markdown message component**

Create `webui/components/markdown-message.tsx`:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownMessage({ content, fromSelf }: { content: string; fromSelf: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none break-words
        ${fromSelf
          ? 'prose-invert'
          : 'prose-neutral'
        }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
```

**Step 4: Create the useChat hook**

Create `webui/hooks/use-chat.ts`:

```typescript
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_bot_message: boolean;
}

export interface ChatInfo {
  jid: string;
  name: string | null;
  last_message_time: string;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [activeChatJid, setActiveChatJid] = useState<string>('web:main');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isTyping, setIsTyping] = useState(false);
  const [assistantName, setAssistantName] = useState('NanoClaw');
  const wsRef = useRef<WebSocket | null>(null);

  // Bootstrap
  useEffect(() => {
    fetch('/api/bootstrap')
      .then((r) => r.json())
      .then((data) => {
        if (data.assistantName) setAssistantName(data.assistantName);
        if (data.chatJid) setActiveChatJid(data.chatJid);
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if (Array.isArray(data.chats)) setChats(data.chats);
      })
      .catch(() => {});
  }, []);

  // Load messages when active chat changes
  const loadChat = useCallback((jid: string) => {
    setActiveChatJid(jid);
    setMessages([]);
    fetch(`/api/chats/${encodeURIComponent(jid)}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => {});
  }, []);

  // WebSocket
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => setStatus('connected'));
      ws.addEventListener('close', () => {
        setStatus('reconnecting');
        setIsTyping(false);
        reconnectTimer = setTimeout(connect, 1200);
      });
      ws.addEventListener('message', (ev) => {
        let frame: { type: string; message?: Message; isTyping?: boolean };
        try { frame = JSON.parse(ev.data as string); } catch { return; }

        if (frame.type === 'message' && frame.message) {
          setMessages((prev) => [...prev, frame.message!]);
          return;
        }
        if (frame.type === 'typing') {
          setIsTyping(Boolean(frame.isTyping));
        }
      });
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const sendMessage = useCallback(async (content: string, chatJid: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'send_message', content: trimmed, chatJid }));
      return;
    }
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed, chatJid }),
    });
  }, []);

  return { messages, chats, activeChatJid, status, isTyping, assistantName, sendMessage, loadChat };
}
```

**Step 5: Create ChatSidebar component**

Create `webui/components/chat-sidebar.tsx`:

```tsx
'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import type { ChatInfo } from '@/hooks/use-chat';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function displayName(chat: ChatInfo): string {
  if (chat.name) return chat.name;
  if (chat.jid === 'web:main') return 'Web UI';
  return chat.jid;
}

interface Props {
  chats: ChatInfo[];
  activeChatJid: string;
  onSelect: (jid: string) => void;
}

export function ChatSidebar({ chats, activeChatJid, onSelect }: Props) {
  return (
    <aside className="w-72 flex-shrink-0 border-r border-black/10 flex flex-col bg-white/40">
      <div className="px-4 py-3 border-b border-black/10">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Chats</p>
      </div>
      <ScrollArea className="flex-1">
        {chats.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No chats yet</p>
        )}
        {chats.map((chat) => (
          <button
            key={chat.jid}
            onClick={() => onSelect(chat.jid)}
            className={`w-full text-left px-4 py-3 border-b border-black/5 hover:bg-white/60 transition-colors ${
              chat.jid === activeChatJid ? 'bg-white/80 font-medium' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{displayName(chat)}</span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {formatTime(chat.last_message_time)}
              </span>
            </div>
          </button>
        ))}
      </ScrollArea>
    </aside>
  );
}
```

**Step 6: Create ChatPanel component**

Create `webui/components/chat-panel.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownMessage } from '@/components/markdown-message';
import type { Message } from '@/hooks/use-chat';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface Props {
  messages: Message[];
  isTyping: boolean;
  activeChatJid: string;
  onSend: (content: string, chatJid: string) => Promise<void>;
}

export function ChatPanel({ messages, isTyping, activeChatJid, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const content = draft;
    setDraft('');
    await onSend(content, activeChatJid);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-3">
          {messages.map((msg) => {
            const fromSelf = !msg.is_bot_message;
            return (
              <article
                key={msg.id}
                className={`flex flex-col gap-1 max-w-[84%] ${fromSelf ? 'ml-auto items-end' : 'items-start'}`}
              >
                <div className="flex gap-2 items-baseline">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {msg.sender_name || (fromSelf ? 'You' : 'Assistant')}
                  </span>
                  <time className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</time>
                </div>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                    fromSelf
                      ? 'bg-[#1f6c5f] text-white'
                      : 'bg-white border border-black/10 text-[#16232f]'
                  }`}
                >
                  <MarkdownMessage content={msg.content || ''} fromSelf={fromSelf} />
                </div>
              </article>
            );
          })}
          {isTyping && (
            <p className="text-xs text-muted-foreground px-1 italic">Assistant is typing…</p>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <Separator />

      <div className="px-4 py-3">
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Message your assistant"
            className="flex-1"
            autoComplete="off"
          />
          <Button type="submit" disabled={!draft.trim()}>Send</Button>
        </form>
      </div>
    </div>
  );
}
```

**Step 7: Create ChatShell (top-level orchestrator)**

Create `webui/components/chat-shell.tsx`:

```tsx
'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ChatPanel } from '@/components/chat-panel';
import { useChat } from '@/hooks/use-chat';

export function ChatShell() {
  const { messages, chats, activeChatJid, status, isTyping, assistantName, sendMessage, loadChat } = useChat();

  const badgeVariant = status === 'connected' ? 'default' : 'secondary';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-white/60 backdrop-blur border-b border-black/10">
        <h1 className="text-lg font-semibold">{assistantName} · Web</h1>
        <Badge variant={badgeVariant}>{status}</Badge>
      </header>

      <Separator />

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        <ChatSidebar
          chats={chats}
          activeChatJid={activeChatJid}
          onSelect={loadChat}
        />
        <ChatPanel
          messages={messages}
          isTyping={isTyping}
          activeChatJid={activeChatJid}
          onSend={sendMessage}
        />
      </div>
    </div>
  );
}
```

**Step 8: Update page.tsx**

Replace `webui/app/page.tsx`:

```tsx
import { ChatShell } from '@/components/chat-shell';

export default function Home() {
  return <ChatShell />;
}
```

**Step 9: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/app/ webui/components/ webui/hooks/
git commit -m "feat(webui): add two-column chat UI with markdown rendering"
```

---

## Task 5: Custom Next.js Server with WebSocket

Next.js App Router doesn't support WebSocket upgrades in API Routes by default. We need a custom server entry point that starts Next.js programmatically and mounts the WebSocket server alongside it.

**Files:**
- Create: `webui/server.ts` (custom Next.js server entry — NOT inside `app/`)
- Modify: `webui/package.json` (update `dev` and `start` scripts to use custom server)

**Step 1: Create the custom server**

Create `webui/server.ts`:

```typescript
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
```

**Step 2: Add tsx to webui devDependencies**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npm install --save-dev tsx
```

**Step 3: Update webui/package.json scripts**

Edit `webui/package.json`, change `scripts` to:

```json
"scripts": {
  "dev": "tsx server.ts",
  "build": "next build",
  "start": "NODE_ENV=production tsx server.ts",
  "lint": "next lint"
}
```

**Step 4: Add tsconfig path for server.ts**

Verify `webui/tsconfig.json` includes `"moduleResolution": "bundler"` or `"node"`. Add `server.ts` to the compilation if excluded. The simplest check:

```bash
cat /Users/antran/Projects/OpenSource/nanoclaw/webui/tsconfig.json
```

If `exclude` includes `"server.ts"`, remove it.

**Step 5: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/server.ts webui/package.json
git commit -m "feat(webui): add custom Next.js server with WebSocket support"
```

---

## Task 6: Wire Next.js into src/index.ts

Replace the import of the old `startWebUiServer` with a new function that starts the Next.js custom server and sets up the bridge.

**Files:**
- Create: `src/webui/nextjs-server.ts` (adapter that starts Next.js and sets the bridge)
- Modify: `src/index.ts` (swap import)

**Step 1: Create the Next.js server adapter**

Create `src/webui/nextjs-server.ts`:

```typescript
import { spawn } from 'child_process';
import path from 'path';
import { setBridge } from '../../webui/lib/bridge.js';
import type { WebChannel } from '../channels/web.js';
import type { WebUiServer } from './server.js';
import { getAllChats, getRecentMessages } from '../db.js';
import { logger } from '../logger.js';

export interface NextJsServerOpts {
  channel: WebChannel;
  assistantName: string;
  chatJid: string;
  host: string;
  port: number;
}

export async function startNextJsServer(opts: NextJsServerOpts): Promise<WebUiServer> {
  // Set up the in-process bridge so Next.js API routes can talk to the channel
  setBridge({
    assistantName: opts.assistantName,
    chatJid: opts.chatJid,
    ingestUserMessage: (chatJid, content, senderName) =>
      opts.channel.ingestUserMessage(chatJid, content, senderName),
    getRecentMessages: (chatJid, limit) => getRecentMessages(chatJid, limit),
    getAllChats: () => getAllChats(),
    subscribe: (listener) => opts.channel.subscribe(listener as Parameters<WebChannel['subscribe']>[0]),
  });

  const webuiDir = path.resolve(process.cwd(), 'webui');

  const child = spawn('npm', ['run', 'dev'], {
    cwd: webuiDir,
    env: {
      ...process.env,
      PORT: String(opts.port),
      HOST: opts.host,
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
    stdio: 'inherit',
  });

  child.on('error', (err) => logger.error({ err }, 'Next.js server error'));

  const url = `http://${opts.host}:${opts.port}`;
  logger.info({ url }, 'Next.js Web UI server starting');

  // Give Next.js a moment to start up
  await new Promise((resolve) => setTimeout(resolve, 2000));

  return {
    url,
    async close(): Promise<void> {
      child.kill();
      await new Promise<void>((resolve) => child.once('exit', resolve));
    },
  };
}
```

**Step 2: Update src/index.ts to use the new adapter**

In `src/index.ts`, change:

```typescript
// OLD:
import { startWebUiServer, WebUiServer } from './webui/server.js';
```

To:

```typescript
// NEW:
import { startNextJsServer } from './webui/nextjs-server.js';
import type { WebUiServer } from './webui/server.js';
```

And change the `startWebUiServer(...)` call (around line 596) to `startNextJsServer(...)`.

**Step 3: Verify TypeScript compiles**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
npm run typecheck
```

Expected: No errors

**Step 4: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add src/webui/nextjs-server.ts src/index.ts
git commit -m "feat: wire Next.js server into main process via bridge adapter"
```

---

## Task 7: End-to-End Test in Chrome

**Step 1: Install webui dependencies**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui && npm install
```

**Step 2: Start the full stack**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
npm run webui
```

Expected log output includes:
- `Web UI server starting`
- Next.js `> Ready on http://127.0.0.1:4317`

**Step 3: Open Chrome and verify**

Open http://127.0.0.1:4317 in Chrome.

Check:
- [ ] Two-column layout visible (sidebar left, chat right)
- [ ] Connection status badge shows "connected"
- [ ] Chat list populates in sidebar
- [ ] Messages load in right panel
- [ ] Selecting a different chat loads its messages
- [ ] Sending a message works (appears in timeline)
- [ ] Typing indicator appears when assistant responds
- [ ] Markdown renders properly (bold, code blocks, lists)
- [ ] Auto-scroll to latest message works

**Step 4: Fix any issues found during testing**

Iterate until all checklist items pass.

**Step 5: Commit fixes**

```bash
git add -u
git commit -m "fix(webui): address issues found during Chrome testing"
```

---

## Task 8: Clean Up Old Files

Once everything is confirmed working:

**Step 1: Delete old webui server and assets**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
rm src/webui/server.ts
rm -rf assets/webui/
```

**Step 2: Update any remaining references**

```bash
grep -r "assets/webui\|startWebUiServer" src/ --include="*.ts"
```

Fix any remaining references found.

**Step 3: Run all tests**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
npm test
```

Expected: All existing tests pass (web channel tests should still pass since `WebChannel` is unchanged)

**Step 4: Final commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add -A
git commit -m "chore: remove old vanilla webui server and assets"
```

---

## Done ✅

Full-stack Next.js Web UI running at http://127.0.0.1:4317 with:
- Two-column layout (chat list + chat detail)
- Real-time WebSocket updates
- Markdown rendering in messages
- shadcn/ui components throughout
- Old `src/webui/server.ts` and `assets/webui/` deleted
