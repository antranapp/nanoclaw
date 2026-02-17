import type { NewMessage } from '../../src/types.js';

export type WebChannelEvent =
  | { type: 'message'; message: NewMessage }
  | { type: 'typing'; chatJid: string; isTyping: boolean };

export type ChannelBridge = {
  assistantName: string;
  chatJid: string;
  ingestUserMessage(chatJid: string, content: string, senderName?: string): Promise<void>;
  getRecentMessages(chatJid: string, limit: number): NewMessage[];
  getAllChats(): Array<{ jid: string; name: string | null; last_message_time: string }>;
  subscribe(listener: (event: WebChannelEvent) => void): () => void;
};

let _bridge: ChannelBridge | null = null;

export function setBridge(bridge: ChannelBridge): void {
  _bridge = bridge;
}

export function getBridge(): ChannelBridge {
  if (!_bridge) throw new Error('Bridge not initialized — is the backend running with --webui?');
  return _bridge;
}
