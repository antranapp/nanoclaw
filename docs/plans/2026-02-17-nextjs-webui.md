# Next.js + shadcn/ui Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the vanilla HTML/CSS/JS web UI in `assets/webui/` with a Next.js app using shadcn/ui components, running as a separate dev server that proxies API/WebSocket requests to the existing Node.js backend.

**Architecture:** The existing Node.js backend (`src/webui/server.ts`) stays completely unchanged — it continues to serve `/api/bootstrap`, `/api/messages`, and the `/api/ws` WebSocket on port `4317` (default). A new Next.js app lives in `webui/` at the project root, runs on port `3001`, and proxies all `/api/*` requests to the backend via Next.js rewrites. The existing `assets/webui/` is kept as fallback but is no longer the primary UI.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, WebSocket (native browser API)

---

## Task 1: Scaffold the Next.js App

**Files:**
- Create: `webui/` (directory)
- Create: `webui/package.json`
- Create: `webui/next.config.ts`
- Create: `webui/tsconfig.json`
- Create: `webui/tailwind.config.ts`
- Create: `webui/postcss.config.mjs`

**Step 1: Scaffold with create-next-app**

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

Expected output: Next.js app created in `webui/`

**Step 2: Verify it scaffolded correctly**

```bash
ls webui/
```

Expected: `app/`, `public/`, `package.json`, `next.config.ts`, `tsconfig.json`

**Step 3: Install shadcn/ui**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npx shadcn@latest init --yes --defaults
```

Expected: shadcn initialized, `components/ui/` directory created, `components.json` written.

**Step 4: Install the specific shadcn components we need**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npx shadcn@latest add button input badge scroll-area separator
```

Expected: Components added to `components/ui/`

**Step 5: Configure Next.js proxy rewrites**

Replace the contents of `webui/next.config.ts` with:

```typescript
import type { NextConfig } from 'next';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:4317';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

**Step 6: Add dev script to root package.json**

Edit `/Users/antran/Projects/OpenSource/nanoclaw/package.json` — add to `scripts`:

```json
"webui:dev": "cd webui && npm run dev -- --port 3001"
```

**Step 7: Verify Next.js starts**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npm run dev -- --port 3001
```

Expected: Server running at http://localhost:3001, default Next.js page visible.

Stop the server (Ctrl+C).

**Step 8: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/ package.json
git commit -m "chore: scaffold Next.js webui with shadcn/ui"
```

---

## Task 2: Build the Chat Page Layout

**Files:**
- Create: `webui/app/page.tsx`
- Create: `webui/app/layout.tsx`
- Create: `webui/app/globals.css`

**Goal:** Render the same chat UI as the current `assets/webui/index.html` but using React + shadcn components. No live data yet — use hardcoded placeholder messages.

**Step 1: Update globals.css**

Replace `webui/app/globals.css` with:

```css
@import "tailwindcss";

:root {
  --background: #f3ead8;
  --foreground: #1d2b36;
}

html, body {
  height: 100%;
  margin: 0;
}
```

**Step 2: Update layout.tsx**

Replace `webui/app/layout.tsx` with:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'NanoClaw',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full bg-[#f3ead8]">{children}</body>
    </html>
  );
}
```

**Step 3: Create the chat page with placeholder data**

Create `webui/app/page.tsx`:

```tsx
import { ChatShell } from '@/components/chat-shell';

export default function Home() {
  return <ChatShell />;
}
```

**Step 4: Create the ChatShell component**

Create `webui/components/chat-shell.tsx`:

```tsx
'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

interface Message {
  id: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_bot_message: boolean;
}

const PLACEHOLDER_MESSAGES: Message[] = [
  {
    id: '1',
    sender_name: 'You',
    content: 'Hello, how are you?',
    timestamp: new Date().toISOString(),
    is_bot_message: false,
  },
  {
    id: '2',
    sender_name: 'Claw',
    content: 'I\'m doing great! How can I help you today?',
    timestamp: new Date().toISOString(),
    is_bot_message: true,
  },
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatShell() {
  const [messages] = useState<Message[]>(PLACEHOLDER_MESSAGES);
  const [draft, setDraft] = useState('');
  const [status] = useState<'connected' | 'connecting' | 'reconnecting'>('connecting');

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-2xl h-[85vh] flex flex-col rounded-2xl border border-black/10 bg-white/75 backdrop-blur-md shadow-2xl">
        {/* Header */}
        <div className="flex items-end justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Local Chat</p>
            <h1 className="text-xl font-serif mt-0.5">NanoClaw</h1>
          </div>
          <Badge variant={status === 'connected' ? 'default' : 'secondary'}>
            {status}
          </Badge>
        </div>

        <Separator />

        {/* Messages */}
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
                    <span className="text-xs font-semibold text-muted-foreground">{msg.sender_name}</span>
                    <time className="text-xs text-muted-foreground">{formatTime(msg.timestamp)}</time>
                  </div>
                  <p
                    className={`m-0 px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      fromSelf
                        ? 'bg-[#1f6c5f] text-white'
                        : 'bg-white border border-black/10 text-[#16232f]'
                    }`}
                  >
                    {msg.content}
                  </p>
                </article>
              );
            })}
          </div>
        </ScrollArea>

        <Separator />

        {/* Composer */}
        <div className="px-4 py-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setDraft('');
            }}
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message your assistant"
              className="flex-1"
              autoComplete="off"
            />
            <Button type="submit" disabled={!draft.trim()}>
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

**Step 5: Start the dev server and visually verify the layout**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npm run dev -- --port 3001
```

Open http://localhost:3001 in the browser. You should see:
- A centered chat card with frosted glass effect
- "Local Chat" eyebrow + "NanoClaw" title
- "connecting" badge
- Two placeholder messages (one green/self, one white/assistant)
- An input + Send button at the bottom

Stop the server.

**Step 6: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/app/ webui/components/
git commit -m "feat(webui): add chat layout with shadcn/ui components"
```

---

## Task 3: Wire Up Live Data with WebSocket Hook

**Files:**
- Create: `webui/hooks/use-chat.ts`
- Modify: `webui/components/chat-shell.tsx`

**Goal:** Replace the placeholder data with real live data from the backend API and WebSocket.

**Step 1: Create the useChat hook**

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

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isTyping, setIsTyping] = useState(false);
  const [chatJid, setChatJid] = useState<string>('web:main');
  const [assistantName, setAssistantName] = useState<string>('NanoClaw');
  const wsRef = useRef<WebSocket | null>(null);

  // Bootstrap: load recent messages + assistant name
  useEffect(() => {
    async function bootstrap() {
      try {
        const res = await fetch('/api/bootstrap');
        if (!res.ok) return;
        const data = await res.json();
        if (data.chatJid) setChatJid(data.chatJid);
        if (data.assistantName) setAssistantName(data.assistantName);
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
      } catch {
        // ignore bootstrap errors, WS will still work
      }
    }
    bootstrap();
  }, []);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      // WS must connect directly to backend, not through Next.js proxy
      // (Next.js rewrites don't support WebSocket upgrades)
      const backendHost = process.env.NEXT_PUBLIC_BACKEND_HOST ?? '127.0.0.1:4317';
      const ws = new WebSocket(`${scheme}://${backendHost}/api/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => setStatus('connected'));

      ws.addEventListener('close', () => {
        setStatus('reconnecting');
        setIsTyping(false);
        reconnectTimer = setTimeout(connect, 1200);
      });

      ws.addEventListener('message', (event) => {
        let frame: { type: string; message?: Message; isTyping?: boolean; chatJid?: string };
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          return;
        }

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

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'send_message', content: trimmed }));
        return;
      }

      // Fallback to REST
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed }),
      });
    },
    [],
  );

  return { messages, status, isTyping, chatJid, assistantName, sendMessage };
}
```

**Step 2: Update ChatShell to use the hook**

Replace `webui/components/chat-shell.tsx` with:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useChat } from '@/hooks/use-chat';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatShell() {
  const { messages, status, isTyping, assistantName, sendMessage } = useChat();
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setDraft('');
    await sendMessage(draft);
  };

  const badgeVariant = status === 'connected' ? 'default' : 'secondary';

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-2xl h-[85vh] flex flex-col rounded-2xl border border-black/10 bg-white/75 backdrop-blur-md shadow-2xl">
        {/* Header */}
        <div className="flex items-end justify-between px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Local Chat</p>
            <h1 className="text-xl font-serif mt-0.5">{assistantName} · Web</h1>
          </div>
          <Badge variant={badgeVariant}>{status}</Badge>
        </div>

        <Separator />

        {/* Messages */}
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
                  <p
                    className={`m-0 px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      fromSelf
                        ? 'bg-[#1f6c5f] text-white'
                        : 'bg-white border border-black/10 text-[#16232f]'
                    }`}
                  >
                    {msg.content}
                  </p>
                </article>
              );
            })}

            {isTyping && (
              <p className="text-xs text-muted-foreground px-1">Assistant is typing…</p>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <Separator />

        {/* Composer */}
        <div className="px-4 py-3">
          <form className="flex gap-2" onSubmit={handleSubmit}>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message your assistant"
              className="flex-1"
              autoComplete="off"
            />
            <Button type="submit" disabled={!draft.trim()}>
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Add NEXT_PUBLIC_BACKEND_HOST to .env.local**

Create `webui/.env.local`:

```
NEXT_PUBLIC_BACKEND_HOST=127.0.0.1:4317
```

> Note: WebSocket connections cannot go through Next.js rewrites (which only handle HTTP). The WS connects directly to the backend. HTTP API calls go through the proxy rewrite and use relative `/api/*` paths.

**Step 4: Start backend in webui mode and test end-to-end**

In terminal 1 (backend):
```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
npm run webui
```

Expected: NanoClaw starts with "Open Web UI in browser" log at http://127.0.0.1:4317

In terminal 2 (Next.js):
```bash
cd /Users/antran/Projects/OpenSource/nanoclaw/webui
npm run dev -- --port 3001
```

Open http://localhost:3001. Verify:
- Status badge shows "connected"
- Past messages load from bootstrap
- Typing a message and pressing Send triggers the assistant
- "Assistant is typing…" appears while the assistant responds
- New messages appear in real-time

**Step 5: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/hooks/ webui/components/chat-shell.tsx webui/.env.local
git commit -m "feat(webui): wire live data via WebSocket and REST API"
```

---

## Task 4: Add Background Orbs (Visual Polish)

**Files:**
- Create: `webui/components/bg-orbs.tsx`
- Modify: `webui/app/layout.tsx`

**Goal:** Recreate the decorative gradient orbs from the original design.

**Step 1: Create bg-orbs component**

Create `webui/components/bg-orbs.tsx`:

```tsx
export function BgOrbs() {
  return (
    <>
      <div
        className="fixed pointer-events-none rounded-full opacity-50 blur-[36px]"
        style={{
          width: '34rem',
          height: '34rem',
          background: '#ef5d3f',
          top: '-12rem',
          left: '-8rem',
        }}
      />
      <div
        className="fixed pointer-events-none rounded-full opacity-50 blur-[36px]"
        style={{
          width: '28rem',
          height: '28rem',
          background: '#49a078',
          bottom: '-10rem',
          right: '-8rem',
        }}
      />
    </>
  );
}
```

**Step 2: Add orbs to layout**

Update `webui/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { BgOrbs } from '@/components/bg-orbs';
import './globals.css';

export const metadata: Metadata = {
  title: 'NanoClaw',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="h-full overflow-hidden bg-gradient-to-br from-[#f3ead8] to-[#dfe8f1]">
        <BgOrbs />
        <main className="relative z-10 h-full">{children}</main>
      </body>
    </html>
  );
}
```

**Step 3: Verify visually**

Open http://localhost:3001. The background should show the orange/teal gradient orbs behind the chat card.

**Step 4: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add webui/components/bg-orbs.tsx webui/app/layout.tsx
git commit -m "feat(webui): add decorative background orbs"
```

---

## Task 5: Update Root package.json and Add .gitignore

**Files:**
- Modify: `/Users/antran/Projects/OpenSource/nanoclaw/package.json`
- Create: `webui/.gitignore` (if not already created by create-next-app)

**Step 1: Check if webui/.gitignore exists**

```bash
cat /Users/antran/Projects/OpenSource/nanoclaw/webui/.gitignore
```

If missing, create it:

```
# dependencies
node_modules/
.pnp
.pnp.*
.yarn/*
!.yarn/patches
!.yarn/releases
!.yarn/plugins
!.yarn/sdks
!.yarn/versions

# testing
/coverage

# next.js
/.next/
/out/

# production
/build

# misc
.DS_Store
*.pem

# debug
npm-debug.log*

# env files
.env*.local
!.env.local.example

# typescript
*.tsbuildinfo
next-env.d.ts
```

**Step 2: Verify root .gitignore excludes webui/node_modules**

```bash
cat /Users/antran/Projects/OpenSource/nanoclaw/.gitignore
```

If `webui/node_modules` or `webui/.next` isn't covered, add to the root `.gitignore`:

```
webui/.next/
webui/node_modules/
```

**Step 3: Commit**

```bash
cd /Users/antran/Projects/OpenSource/nanoclaw
git add .gitignore webui/.gitignore package.json
git commit -m "chore(webui): add gitignore and root script for dev"
```

---

## Done ✅

After all tasks complete, the Next.js web UI is live at http://localhost:3001.

**To run the full stack:**

```bash
# Terminal 1 — backend (port 4317)
npm run webui

# Terminal 2 — Next.js UI (port 3001)
npm run webui:dev
```

**Key decisions made:**
- HTTP API calls go through Next.js proxy rewrites (`/api/*` → `127.0.0.1:4317/api/*`)
- WebSocket connects directly to backend (rewrites don't support WS upgrades)
- `NEXT_PUBLIC_BACKEND_HOST` env var controls WS target (defaults to `127.0.0.1:4317`)
- `assets/webui/` remains untouched as fallback
