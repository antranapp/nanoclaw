import { NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function GET() {
  try {
    const bridge = getBridge();
    const messages = bridge.getRecentMessages(bridge.chatJid, 200);
    const chats = bridge.getAllChats();
    return NextResponse.json({
      assistantName: bridge.assistantName,
      chatJid: bridge.chatJid,
      messages,
      chats,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
