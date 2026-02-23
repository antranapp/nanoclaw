'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ChatSidebar } from '@/components/chat-sidebar';
import { ChatPanel } from '@/components/chat-panel';
import { NewGroupDialog } from '@/components/new-group-dialog';
import { useChat } from '@/hooks/use-chat';

export function ChatShell() {
  const {
    messages,
    groups,
    activeFolder,
    activeChatJid,
    status,
    isTyping,
    assistantName,
    sendMessage,
    loadGroup,
    createGroup,
    deleteGroup,
  } = useChat();

  const [newGroupOpen, setNewGroupOpen] = useState(false);

  const badgeVariant = status === 'connected' ? 'default' : status === 'disconnected' ? 'destructive' : 'secondary';

  const activeGroupName = groups.find((g) => g.folder === activeFolder)?.name ?? 'Chat';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-white/60 backdrop-blur border-b border-black/10">
        <h1 className="text-lg font-semibold">{assistantName} · {activeGroupName}</h1>
        <Badge variant={badgeVariant}>{status}</Badge>
      </header>

      <Separator />

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0">
        <ChatSidebar
          groups={groups}
          activeFolder={activeFolder}
          onSelect={loadGroup}
          onNewGroup={() => setNewGroupOpen(true)}
          onDeleteGroup={deleteGroup}
        />
        <ChatPanel
          messages={messages}
          isTyping={isTyping}
          activeChatJid={activeChatJid}
          onSend={sendMessage}
        />
      </div>

      <NewGroupDialog
        open={newGroupOpen}
        onOpenChange={setNewGroupOpen}
        onCreate={createGroup}
      />
    </div>
  );
}
