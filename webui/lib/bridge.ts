// Self-contained bridge types (no cross-boundary imports so Next.js can bundle this)
export interface BridgeMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
}

export type WebChannelEvent =
  | { type: 'message'; message: BridgeMessage }
  | { type: 'typing'; chatJid: string; isTyping: boolean };

export type ChannelBridge = {
  assistantName: string;
  chatJid: string;
  ingestUserMessage(chatJid: string, content: string, senderName?: string): Promise<void>;
  getRecentMessages(chatJid: string, limit: number): BridgeMessage[];
  getAllChats(): Array<{ jid: string; name: string | null; last_message_time: string }>;
  subscribe(listener: (event: WebChannelEvent) => void): () => void;
};

// Use globalThis so the singleton survives Next.js module re-bundling (Turbopack/Webpack
// may create separate module instances, but globalThis is shared across the V8 isolate)
const g = globalThis as unknown as { __nanoclawBridge?: ChannelBridge };

export function setBridge(bridge: ChannelBridge): void {
  g.__nanoclawBridge = bridge;
}

export function getBridge(): ChannelBridge {
  if (!g.__nanoclawBridge) throw new Error('Bridge not initialized — is the backend running with --webui?');
  return g.__nanoclawBridge;
}
