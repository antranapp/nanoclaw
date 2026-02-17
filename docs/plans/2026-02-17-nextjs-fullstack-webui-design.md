# Full-Stack Next.js Web UI Design

**Date:** 2026-02-17
**Status:** Approved

## Goal

Replace the hand-rolled `src/webui/server.ts` with a full-stack Next.js application that handles both the HTTP/WebSocket API and the React UI. Uses shadcn/ui components.

## Architecture

The existing Node.js orchestrator (`src/index.ts`) and `WebChannel` (`src/channels/web.ts`) remain unchanged. Next.js runs as the web server on port `4317` (same as current `WEBUI_PORT`), replacing `src/webui/server.ts` entirely.

```
src/index.ts (unchanged)
  └── WebChannel (unchanged)
       └── webui/                         ← New Next.js app
            ├── app/api/bootstrap/        ← GET /api/bootstrap
            ├── app/api/messages/         ← POST /api/messages
            ├── app/api/ws/               ← WebSocket /api/ws
            └── app/                     ← React UI
```

`src/webui/server.ts` and `assets/webui/` are deleted once the Next.js app is working.

## UI Layout

Two-column layout, full viewport height:

- **Left sidebar (~280px):** Scrollable list of chat sessions. Each row shows name, last message preview, and timestamp. Active session is highlighted. Clicking a session loads its messages on the right.
- **Right panel (flex-1):** Message timeline (auto-scrolling), typing indicator, composer (input + Send button) pinned to bottom.
- **Header:** App name "NanoClaw", connection status badge.

## Data Flow

1. On load: `GET /api/bootstrap` returns `{ chatJid, assistantName, messages, chats[] }` — chats is the list for the sidebar.
2. User selects a chat → `GET /api/chats/:jid/messages` returns history for that session.
3. Sending: `POST /api/messages` with `{ chatJid, content }`.
4. Real-time: WebSocket at `/api/ws` — same protocol as current (`send_message`, `message`, `typing` frames).

## Tech Stack

- Next.js 15 (App Router), React 19, TypeScript
- Tailwind CSS, shadcn/ui (Button, Input, Badge, ScrollArea, Separator)
- Native WebSocket API (browser), `ws` package (server-side via Next.js custom server)

## What Gets Deleted

- `src/webui/server.ts`
- `assets/webui/` (index.html, styles.css, app.js)

## What Stays Unchanged

- `src/channels/web.ts` (WebChannel)
- `src/index.ts` startup logic (still checks `--webui` flag, reads `WEBUI_PORT`)
- All tests for `WebChannel`
