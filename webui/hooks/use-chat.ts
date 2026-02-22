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

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

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
    let retries = 0;
    const MAX_RETRIES = 8;
    const BASE_DELAY = 1200;

    function connect() {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL
        ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        retries = 0;
        setStatus('connected');
      });
      ws.addEventListener('close', () => {
        setIsTyping(false);
        retries++;
        if (retries > MAX_RETRIES) {
          setStatus('disconnected');
          return;
        }
        setStatus('reconnecting');
        const delay = Math.min(BASE_DELAY * Math.pow(2, retries - 1), 30000);
        reconnectTimer = setTimeout(connect, delay);
      });
      ws.addEventListener('message', (ev) => {
        let frame: { type: string; message?: Message; isTyping?: boolean };
        try { frame = JSON.parse(ev.data as string); } catch { return; }

        if (frame.type === 'message' && frame.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === frame.message!.id)) return prev;
            return [...prev, frame.message!];
          });
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
