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

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

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

    function connect() {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${scheme}://${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.addEventListener('open', () => setStatus('connected'));
      ws.addEventListener('close', () => {
        setStatus('reconnecting');
        setIsTyping(false);
        reconnectTimer = setTimeout(connect, 1200);
      });
      ws.addEventListener('message', (ev) => {
        let frame: { type: string; message?: Message; isTyping?: boolean };
        try { frame = JSON.parse(ev.data as string); } catch { return; }

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
