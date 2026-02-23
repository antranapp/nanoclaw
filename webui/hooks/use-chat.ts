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

export interface GroupInfo {
  name: string;
  folder: string;
  webJid: string | null;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [activeFolder, setActiveFolder] = useState('main');
  const [activeChatJid, setActiveChatJid] = useState<string>('web:main');
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [isTyping, setIsTyping] = useState(false);
  const [assistantName, setAssistantName] = useState('NanoClaw');
  const wsRef = useRef<WebSocket | null>(null);
  const activeFolderRef = useRef(activeFolder);

  // Keep ref in sync so WS handler sees current value
  useEffect(() => {
    activeFolderRef.current = activeFolder;
  }, [activeFolder]);

  // Bootstrap
  useEffect(() => {
    fetch('/api/bootstrap')
      .then((r) => r.json())
      .then((data) => {
        if (data.assistantName) setAssistantName(data.assistantName);
        if (data.chatJid) setActiveChatJid(data.chatJid);
        if (Array.isArray(data.messages)) setMessages(data.messages);
        if (Array.isArray(data.chats)) setChats(data.chats);
        if (Array.isArray(data.groups)) setGroups(data.groups);
        if (data.activeFolder) setActiveFolder(data.activeFolder);
      })
      .catch(() => {});
  }, []);

  // Load messages for a group folder (cross-channel history)
  const loadGroup = useCallback((folder: string) => {
    setActiveFolder(folder);
    const webJid = `web:${folder}`;
    setActiveChatJid(webJid);
    setMessages([]);
    setIsTyping(false);
    fetch(`/api/groups/${encodeURIComponent(folder)}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages)) setMessages(data.messages);
      })
      .catch(() => {});
  }, []);

  // Legacy: load a single chat by JID
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

  // Create a new group
  const createGroup = useCallback(async (name: string): Promise<GroupInfo | null> => {
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newGroup = data.group as GroupInfo;

      // Refresh groups list
      const groupsRes = await fetch('/api/groups');
      const groupsData = await groupsRes.json();
      if (Array.isArray(groupsData.groups)) setGroups(groupsData.groups);

      // Switch to the new group
      loadGroup(newGroup.folder);
      return newGroup;
    } catch {
      return null;
    }
  }, [loadGroup]);

  // Delete a group
  const deleteGroup = useCallback(async (folder: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(folder)}`, {
        method: 'DELETE',
      });
      if (!res.ok) return false;

      // Refresh groups list
      const groupsRes = await fetch('/api/groups');
      const groupsData = await groupsRes.json();
      if (Array.isArray(groupsData.groups)) setGroups(groupsData.groups);

      // Switch to main if we deleted the active group
      setActiveFolder((current) => {
        if (current === folder) {
          loadGroup('main');
        }
        return current === folder ? 'main' : current;
      });

      return true;
    } catch {
      return false;
    }
  }, [loadGroup]);

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
        let frame: { type: string; message?: Message; isTyping?: boolean; chatJid?: string };
        try { frame = JSON.parse(ev.data as string); } catch { return; }

        if (frame.type === 'message' && frame.message) {
          // Only append if message belongs to the active group
          const msgJid = frame.message.chat_jid;
          const currentFolder = activeFolderRef.current;
          const belongsToActive =
            msgJid === `web:${currentFolder}` ||
            msgJid.startsWith(`web:${currentFolder}`);

          if (belongsToActive) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === frame.message!.id)) return prev;
              return [...prev, frame.message!];
            });
          }
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

  return {
    messages,
    chats,
    groups,
    activeFolder,
    activeChatJid,
    status,
    isTyping,
    assistantName,
    sendMessage,
    loadChat,
    loadGroup,
    createGroup,
    deleteGroup,
  };
}
