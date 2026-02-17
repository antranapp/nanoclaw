import { NextRequest, NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jid: string }> },
) {
  try {
    const { jid } = await params;
    const chatJid = decodeURIComponent(jid);
    const messages = getBridge().getRecentMessages(chatJid, 200);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
