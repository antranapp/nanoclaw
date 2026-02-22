'use client';

import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ChatPanel } from '@/components/chat-panel';
import { useChat } from '@/hooks/use-chat';

export function ChatShell() {
  const { messages, chats, activeChatJid, status, isTyping, assistantName, sendMessage, loadChat } = useChat();

  const badgeVariant = status === 'connected' ? 'default' : status === 'disconnected' ? 'destructive' : 'secondary';

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
