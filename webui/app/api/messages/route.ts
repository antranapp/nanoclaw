import { NextRequest, NextResponse } from 'next/server';
import { getBridge } from '@/lib/bridge';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { content?: string; chatJid?: string };
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const chatJid = typeof body.chatJid === 'string' ? body.chatJid : getBridge().chatJid;
    if (!content) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }
    await getBridge().ingestUserMessage(chatJid, content, 'You');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
