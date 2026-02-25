'use client';

import { useEffect, useRef, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MarkdownMessage } from '@/components/markdown-message';
import { formatTime } from '@/lib/date';
import type { Message } from '@/hooks/use-chat';

interface Props {
  messages: Message[];
  isTyping: boolean;
  activeChatJid: string;
  onSend: (content: string, chatJid: string) => Promise<void>;
}

export function ChatPanel({ messages, isTyping, activeChatJid, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll instantly on mount (tab switch) or chat switch;
  // smooth-scroll only for new messages / typing within the same chat.
  const prevChatRef = useRef(activeChatJid);
  const mountedRef = useRef(false);
  useEffect(() => {
    const isMount = !mountedRef.current;
    if (isMount) mountedRef.current = true;
    const chatChanged = prevChatRef.current !== activeChatJid;
    if (chatChanged) prevChatRef.current = activeChatJid;
    const instant = isMount || chatChanged;
    bottomRef.current?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth' });
  }, [messages, isTyping, activeChatJid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    const content = draft;
    setDraft('');
    await onSend(content, activeChatJid);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-3 px-4 py-3">
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
