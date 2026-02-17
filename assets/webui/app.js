const timeline = document.getElementById('timeline');
const statusEl = document.getElementById('status');
const titleEl = document.getElementById('title');
const typingEl = document.getElementById('typing');
const composer = document.getElementById('composer');
const input = document.getElementById('message-input');
const template = document.getElementById('message-template');

let websocket;
let chatJid = 'web:main';

const boot = await fetch('/api/bootstrap');
if (!boot.ok) {
  statusEl.textContent = 'bootstrap failed';
  throw new Error('Failed to load bootstrap data');
}

const bootstrap = await boot.json();
chatJid = bootstrap.chatJid;

if (bootstrap.assistantName) {
  titleEl.textContent = `${bootstrap.assistantName} • Web`;
}

if (Array.isArray(bootstrap.messages)) {
  for (const message of bootstrap.messages) {
    renderMessage(message);
  }
}

connectWebSocket();

composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content) return;

  input.value = '';

  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ type: 'send_message', content }));
    return;
  }

  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
});

function connectWebSocket() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  websocket = new WebSocket(`${scheme}://${location.host}/api/ws`);

  websocket.addEventListener('open', () => {
    statusEl.textContent = 'connected';
  });

  websocket.addEventListener('close', () => {
    statusEl.textContent = 'reconnecting';
    typingEl.classList.add('hidden');
    setTimeout(connectWebSocket, 1200);
  });

  websocket.addEventListener('message', (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }

    if (frame.type === 'message' && frame.message) {
      if (frame.message.chat_jid === chatJid) {
        renderMessage(frame.message);
      }
      return;
    }

    if (frame.type === 'typing') {
      const active = Boolean(frame.isTyping);
      typingEl.classList.toggle('hidden', !active);
      return;
    }

    if (frame.type === 'error') {
      statusEl.textContent = 'error';
    }
  });
}

function renderMessage(message) {
  const node = template.content.firstElementChild.cloneNode(true);
  const fromSelf = !Boolean(message.is_bot_message);
  node.classList.toggle('self', fromSelf);

  node.querySelector('.author').textContent = message.sender_name || (fromSelf ? 'You' : 'Assistant');
  node.querySelector('.time').textContent = formatTime(message.timestamp);
  node.querySelector('.bubble').textContent = message.content || '';

  timeline.appendChild(node);
  timeline.scrollTop = timeline.scrollHeight;
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
