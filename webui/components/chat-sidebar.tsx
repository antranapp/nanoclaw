'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { GroupInfo } from '@/hooks/use-chat';

interface Props {
  groups: GroupInfo[];
  activeFolder: string;
  onSelect: (folder: string) => void;
  onNewGroup: () => void;
  onDeleteGroup: (folder: string) => void;
}

export function ChatSidebar({ groups, activeFolder, onSelect, onNewGroup, onDeleteGroup }: Props) {
  // Sort: main first, then alphabetical
  const sorted = [...groups].sort((a, b) => {
    if (a.folder === 'main') return -1;
    if (b.folder === 'main') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <aside className="w-72 flex-shrink-0 border-r border-black/10 flex flex-col bg-white/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-black/10 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Chats</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={onNewGroup}
        >
          + New Chat
        </Button>
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
        {sorted.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No chats yet</p>
        )}
        {sorted.map((group) => (
          <div
            key={group.folder}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(group.folder)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(group.folder); }}
            className={`group w-full text-left px-4 py-3 border-b border-black/5 hover:bg-white/60 transition-colors cursor-pointer ${
              group.folder === activeFolder ? 'bg-white/80 font-medium' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{group.name}</span>
              {group.folder !== 'main' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteGroup(group.folder);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity text-xs px-1"
                  title="Delete group"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </ScrollArea>
    </aside>
  );
}
