import {
  OnInboundMessage,
  OnChatMetadata,
  Channel,
  NewMessage,
} from '../types.js';

export type WebChannelEvent =
  | { type: 'message'; message: NewMessage }
  | { type: 'typing'; chatJid: string; isTyping: boolean };

export interface WebChannelOpts {
  assistantName: string;
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
}

export class WebChannel implements Channel {
  name = 'web';

  private connected = false;
  private listeners = new Set<(event: WebChannelEvent) => void>();
  private opts: WebChannelOpts;

  constructor(opts: WebChannelOpts) {
    this.opts = opts;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.listeners.clear();
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  subscribe(listener: (event: WebChannelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async ingestUserMessage(
    chatJid: string,
    content: string,
    senderName = 'You',
  ): Promise<void> {
    if (!this.connected) return;

    const message: NewMessage = {
      id: this.makeMessageId('user'),
      chat_jid: chatJid,
      sender: 'user@web',
      sender_name: senderName,
      content,
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    };

    this.opts.onChatMetadata(chatJid, message.timestamp, 'Web UI');
    this.opts.onMessage(chatJid, message);
    this.emit({ type: 'message', message });
  }

  async sendMessage(chatJid: string, text: string): Promise<void> {
    if (!this.connected) return;

    const message: NewMessage = {
      id: this.makeMessageId('bot'),
      chat_jid: chatJid,
      sender: 'assistant@web',
      sender_name: this.opts.assistantName,
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: true,
      is_bot_message: true,
    };

    this.opts.onChatMetadata(chatJid, message.timestamp, 'Web UI');
    this.opts.onMessage(chatJid, message);
    this.emit({ type: 'message', message });
  }

  async setTyping(chatJid: string, isTyping: boolean): Promise<void> {
    if (!this.connected) return;
    this.emit({ type: 'typing', chatJid, isTyping });
  }

  private emit(event: WebChannelEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures so one client does not affect others.
      }
    }
  }

  private makeMessageId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
