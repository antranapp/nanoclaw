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
    <aside className="w-72 flex-shrink-0 border-r border-black/10 flex flex-col bg-white/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-black/10">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Chats</p>
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
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
