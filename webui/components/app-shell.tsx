'use client';

import { useState } from 'react';
import { MessageSquare, Settings } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ChatShell } from './chat-shell';
import { TasksPanel } from './tasks/tasks-panel';

type View = 'chat' | 'settings';

const NAV_ITEMS: { id: View; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export function AppShell() {
  const [activeView, setActiveView] = useState<View>('chat');

  return (
    <div className="flex h-full">
      {/* Icon sidebar */}
      <TooltipProvider delayDuration={200}>
        <nav className="flex flex-col items-center w-12 shrink-0 py-3 gap-2 border-r border-black/10 bg-white/40 backdrop-blur">
          {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveView(id)}
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-lg transition-colors',
                    activeView === id
                      ? 'bg-black/10 text-foreground'
                      : 'text-muted-foreground hover:bg-black/5 hover:text-foreground',
                  )}
                >
                  <Icon className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
      </TooltipProvider>

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {activeView === 'chat' ? <ChatShell /> : <TasksPanel />}
      </div>
    </div>
  );
}
