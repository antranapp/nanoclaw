# Development Guide

## Architecture Overview

NanoClaw runs as a single Node.js process (`src/index.ts`) with an optional Web UI. The Web UI uses a two-server architecture:

- **Port 4317** — Main server: handles all API routes, WebSocket, and proxies UI requests
- **Port 4318** — Next.js dev server (internal): renders the React frontend

The main server owns all data access (SQLite via `src/db.ts`) and proxies UI asset requests to Next.js. This keeps data access in one process and avoids cross-process DB access.

## Running in Development

### Backend only (no UI)

```bash
npm run dev
```

Starts the main NanoClaw process with hot reload via `tsx`.

### Backend + Web UI (recommended)

```bash
npm run webui
```

Starts everything together:
1. Main HTTP server on **port 4317** — handles all API routes and WebSocket
2. Next.js dev server on **port 4318** (internal) — renders the React UI with HMR

Open `http://localhost:4317` in your browser. Next.js HMR works for frontend changes.

### Frontend dev server (proxied to running backend)

For isolated frontend development — backend-only process + separate Next.js:

```bash
# Terminal 1 — backend + API/WS server on port 4317 (no embedded Next.js)
npm run webui:backend

# Terminal 2 — standalone Next.js on port 4319, proxied to 4317
npm run webui:dev
```

`npm run webui:backend` starts the backend with the HTTP API and WebSocket exposed on port 4317 but does **not** spawn an internal Next.js instance. `npm run webui:dev` then connects to it.

## Project Structure

```
nanoclaw/
├── src/
│   ├── index.ts              # Main orchestrator (start here)
│   ├── webui/
│   │   └── nextjs-server.ts  # Composite server: API + WebSocket + Next.js proxy
│   ├── channels/
│   │   └── web.ts            # Web channel (WebSocket event bus)
│   ├── db.ts                 # All SQLite operations
│   └── config.ts             # Env vars and constants
└── webui/                    # Next.js frontend
    ├── app/
    │   ├── layout.tsx
    │   └── page.tsx          # Root page (mounts AppShell)
    ├── components/
    │   ├── app-shell.tsx     # Top-level layout (sidebar + panel)
    │   ├── chat-shell.tsx    # Chat view wrapper
    │   ├── chat-sidebar.tsx  # Chat list
    │   ├── chat-panel.tsx    # Message thread + input
    │   └── tasks/            # Cron/scheduled task components
    │       ├── tasks-panel.tsx
    │       ├── task-card.tsx
    │       ├── task-dialog.tsx
    │       ├── cron-editor.tsx
    │       └── interval-picker.tsx
    └── hooks/
        └── use-tasks.ts      # Task CRUD + state hook
```

## API Routes

All routes are handled in `src/webui/nextjs-server.ts`:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bootstrap` | Initial load: assistant name, chats, recent messages |
| `GET` | `/api/chats/:jid/messages` | Message history for a chat |
| `POST` | `/api/messages` | Send a message |
| `GET` | `/api/groups` | List registered groups |
| `GET` | `/api/tasks` | List all scheduled tasks |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |
| `POST` | `/api/tasks/:id/pause` | Pause a task |
| `POST` | `/api/tasks/:id/resume` | Resume a task |
| `WS` | `/api/ws` | Real-time message/typing events |

## Real-time Updates

The frontend connects to `ws://localhost:4317/api/ws`. The server pushes:

```json
{ "type": "message", "message": { ... } }
{ "type": "typing", "chatJid": "...", "isTyping": true }
```

The client can send:

```json
{ "type": "send_message", "content": "...", "chatJid": "..." }
{ "type": "ping" }
```

## Frontend Tech Stack

- **Next.js 16** with React 19 (App Router)
- **Tailwind CSS v4**
- **shadcn/ui** components (in `webui/components/ui/`)
- **lucide-react** icons
- **cronstrue** for human-readable cron descriptions

Adding a new shadcn component:

```bash
cd webui && npx shadcn add <component-name>
```

## Installing Dependencies

Backend:

```bash
npm install
```

Frontend:

```bash
cd webui && npm install
```

## TypeScript

```bash
npm run typecheck      # Check main source
cd webui && npx tsc --noEmit  # Check frontend
```

## Building for Production

```bash
npm run build          # Compiles src/ and agent-runner/
cd webui && npm run build   # Builds Next.js static output
```

In production, the main server spawns `next start` instead of the dev server.
