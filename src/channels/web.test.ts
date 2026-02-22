import { describe, it, expect, vi, beforeEach } from 'vitest';

import { WebChannel } from './web.js';

describe('WebChannel', () => {
  let onMessage: any;
  let onChatMetadata: any;
  let channel: WebChannel;

  beforeEach(async () => {
    onMessage = vi.fn();
    onChatMetadata = vi.fn();
    channel = new WebChannel({
      assistantName: 'Andy',
      onMessage,
      onChatMetadata,
    });
    await channel.connect();
  });

  it('owns web:* JIDs', () => {
    expect(channel.ownsJid('web:main')).toBe(true);
    expect(channel.ownsJid('12345@g.us')).toBe(false);
  });

  it('emits and stores inbound user messages', async () => {
    const events: unknown[] = [];
    const unsubscribe = channel.subscribe((event) => events.push(event));

    await channel.ingestUserMessage('web:main', 'hello');

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(
      'web:main',
      expect.objectContaining({
        chat_jid: 'web:main',
        content: 'hello',
        is_bot_message: false,
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({ content: 'hello' }),
      }),
    ]);

    unsubscribe();
  });

  it('emits and stores outbound assistant messages without prefix changes', async () => {
    const events: unknown[] = [];
    channel.subscribe((event) => events.push(event));

    await channel.sendMessage('web:main', 'Hello there');

    expect(onMessage).toHaveBeenCalledWith(
      'web:main',
      expect.objectContaining({
        content: 'Hello there',
        sender_name: 'Andy',
        is_bot_message: true,
      }),
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: 'message',
        message: expect.objectContaining({ content: 'Hello there' }),
      }),
    ]);
  });

  it('emits typing events', async () => {
    const events: unknown[] = [];
    channel.subscribe((event) => events.push(event));

    await channel.setTyping('web:main', true);

    expect(events).toEqual([
      {
        type: 'typing',
        chatJid: 'web:main',
        isTyping: true,
      },
    ]);
  });

  it('does not emit events after disconnect', async () => {
    const events: unknown[] = [];
    channel.subscribe((event) => events.push(event));

    await channel.disconnect();

    await channel.ingestUserMessage('web:main', 'ignored');
    await channel.sendMessage('web:main', 'also ignored');
    await channel.setTyping('web:main', true);

    expect(events).toHaveLength(0);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivering events to that listener', async () => {
    const events1: unknown[] = [];
    const events2: unknown[] = [];
    const unsub1 = channel.subscribe((e) => events1.push(e));
    channel.subscribe((e) => events2.push(e));

    await channel.sendMessage('web:main', 'first');
    unsub1();
    await channel.sendMessage('web:main', 'second');

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(2);
  });

  it('listener errors do not affect other listeners', async () => {
    const events: unknown[] = [];
    channel.subscribe(() => { throw new Error('boom'); });
    channel.subscribe((e) => events.push(e));

    await channel.sendMessage('web:main', 'still works');

    expect(events).toHaveLength(1);
    expect((events[0] as any).message.content).toBe('still works');
  });
});
