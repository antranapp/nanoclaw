import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  POLL_INTERVAL,
  TRIGGER_PATTERN,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { WebChannel } from './channels/web.js';
import {
  AgentOutput,
  runAgent as runProcessAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './process-runner.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSinceForJids,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { startIpcWatcher } from './ipc.js';
import {
  findChannel,
  formatMessages,
  formatOutbound,
  routeOutbound,
} from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';
import { startNextJsServer } from './webui/nextjs-server.js';
import type { WebUiServer } from './webui/server.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

const WEB_MAIN_JID = 'web:main';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestampByFolder: Record<string, string> = {};
let messageLoopRunning = false;

let channels: Channel[] = [];
let whatsapp: WhatsAppChannel;
let webChannel: WebChannel | null = null;
let webUiServer: WebUiServer | null = null;
const queue = new GroupQueue();

function inferChannelFromJid(jid: string): 'web' | 'whatsapp' {
  if (jid.startsWith('web:')) return 'web';
  return 'whatsapp';
}

function getJidsForFolder(folder: string): string[] {
  return Object.entries(registeredGroups)
    .filter(([, group]) => group.folder === folder)
    .map(([jid]) => jid);
}

function getFolderGroup(folder: string): RegisteredGroup | undefined {
  for (const group of Object.values(registeredGroups)) {
    if (group.folder === folder) return group;
  }
  return undefined;
}

function getUniqueFolders(): string[] {
  return [...new Set(Object.values(registeredGroups).map((g) => g.folder))];
}

function normalizeLastAgentTimestamps(
  raw: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, timestamp] of Object.entries(raw)) {
    const folder = registeredGroups[key]?.folder || key;
    const existing = normalized[folder];
    if (!existing || timestamp > existing) {
      normalized[folder] = timestamp;
    }
  }

  return normalized;
}

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';

  let rawAgentCursor: Record<string, string> = {};
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    rawAgentCursor = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
  }

  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  lastAgentTimestampByFolder = normalizeLastAgentTimestamps(rawAgentCursor);

  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestampByFolder),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group, inferChannelFromJid(jid));

  // Create group folder
  const groupDir = path.join(DATA_DIR, '..', 'groups', group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

function ensureWebMainBinding(): void {
  if (registeredGroups[WEB_MAIN_JID]) return;

  const existingMain = Object.values(registeredGroups).find(
    (group) => group.folder === MAIN_GROUP_FOLDER,
  );

  const now = new Date().toISOString();
  registerGroup(
    WEB_MAIN_JID,
    existingMain
      ? {
          ...existingMain,
          added_at: existingMain.added_at || now,
        }
      : {
          name: 'Main',
          folder: MAIN_GROUP_FOLDER,
          trigger: `@${ASSISTANT_NAME}`,
          added_at: now,
          requiresTrigger: false,
        },
  );

  storeChatMetadata(WEB_MAIN_JID, now, 'Web UI');
}

async function sendOutbound(
  chatJid: string,
  rawText: string,
): Promise<boolean> {
  const text = formatOutbound(rawText);
  if (!text) return false;
  await routeOutbound(channels, chatJid, text);
  return true;
}

async function setTyping(chatJid: string, isTyping: boolean): Promise<void> {
  const channel = findChannel(channels, chatJid);
  if (channel?.setTyping) {
    await channel.setTyping(chatJid, isTyping);
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./process-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.jid.endsWith('@g.us'))
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group folder.
 * Called by the GroupQueue when it's this folder's turn.
 */
async function processGroupMessages(groupFolder: string): Promise<boolean> {
  const group = getFolderGroup(groupFolder);
  if (!group) return true;

  const boundJids = getJidsForFolder(groupFolder);
  if (boundJids.length === 0) return true;

  const sinceTimestamp = lastAgentTimestampByFolder[groupFolder] || '';
  const missedMessages = getMessagesSinceForJids(
    boundJids,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  const targetChatJid = missedMessages[missedMessages.length - 1].chat_jid;
  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestampByFolder[groupFolder] || '';
  lastAgentTimestampByFolder[groupFolder] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    {
      group: group.name,
      groupFolder,
      messageCount: missedMessages.length,
      targetChatJid,
    },
    'Processing messages',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name, groupFolder },
        'Idle timeout, closing agent stdin',
      );
      queue.closeStdin(groupFolder);
    }, IDLE_TIMEOUT);
  };

  await setTyping(targetChatJid, true);
  let hadError = false;
  let outputSentToUser = false;

  const output = await runAgent(
    group,
    prompt,
    targetChatJid,
    groupFolder,
    async (result) => {
      // Streaming output callback — called for each agent result
      if (result.result) {
        const raw =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result);
        logger.info(
          { group: group.name },
          `Agent output: ${raw.slice(0, 200)}`,
        );

        if (await sendOutbound(targetChatJid, raw)) {
          outputSentToUser = true;
        }

        // Only reset idle timer on actual results, not session-update markers (result: null)
        resetIdleTimer();
      }

      if (result.status === 'error') {
        hadError = true;
      }
    },
  );

  await setTyping(targetChatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestampByFolder[groupFolder] = previousCursor;
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  groupKey: string,
  onOutput?: (output: AgentOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for agent to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: AgentOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runProcessAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
      },
      (proc, processName) =>
        queue.registerProcess(
          groupKey,
          proc,
          processName,
          group.folder,
          chatJid,
        ),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error({ group: group.name, error: output.error }, 'Agent error');
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        const messagesByFolder = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const group = registeredGroups[msg.chat_jid];
          if (!group) continue;
          const existing = messagesByFolder.get(group.folder);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByFolder.set(group.folder, [msg]);
          }
        }

        for (const [folder, folderMessages] of messagesByFolder) {
          const group = getFolderGroup(folder);
          if (!group) continue;

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = folderMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          const boundJids = getJidsForFolder(folder);

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSinceForJids(
            boundJids,
            lastAgentTimestampByFolder[folder] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : folderMessages;
          const targetChatJid =
            messagesToSend[messagesToSend.length - 1].chat_jid;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(folder, formatted, targetChatJid)) {
            logger.debug(
              { folder, targetChatJid, count: messagesToSend.length },
              'Piped messages to active agent',
            );
            lastAgentTimestampByFolder[folder] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the agent processes the piped message
            await setTyping(targetChatJid, true);
          } else {
            // No active agent — enqueue for a new one
            queue.enqueueMessageCheck(folder);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const folder of getUniqueFolders()) {
    const boundJids = getJidsForFolder(folder);
    const sinceTimestamp = lastAgentTimestampByFolder[folder] || '';
    const pending = getMessagesSinceForJids(
      boundJids,
      sinceTimestamp,
      ASSISTANT_NAME,
    );

    if (pending.length > 0) {
      logger.info(
        {
          group: folder,
          pendingCount: pending.length,
        },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(folder);
    }
  }
}

async function main(): Promise<void> {
  const enableWebUi = process.argv.includes('--webui');

  initDatabase();
  logger.info('Database initialized');
  loadState();

  if (enableWebUi) {
    ensureWebMainBinding();
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);

    if (webUiServer) {
      await webUiServer.close();
    }

    for (const channel of channels) {
      await channel.disconnect();
    }

    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Create WhatsApp channel
  whatsapp = new WhatsAppChannel({
    onMessage: (_chatJid, msg) => storeMessage(msg),
    onChatMetadata: (chatJid, timestamp) =>
      storeChatMetadata(chatJid, timestamp),
    registeredGroups: () => registeredGroups,
  });
  channels.push(whatsapp);

  // Connect — resolves when first connected
  await whatsapp.connect();

  if (enableWebUi) {
    webChannel = new WebChannel({
      assistantName: ASSISTANT_NAME,
      onMessage: (_chatJid, msg) => storeMessage(msg),
      onChatMetadata: (chatJid, timestamp, name) =>
        storeChatMetadata(chatJid, timestamp, name),
    });
    await webChannel.connect();
    channels.push(webChannel);

    const port = parseInt(process.env.WEBUI_PORT || '4317', 10);
    webUiServer = await startNextJsServer({
      channel: webChannel,
      assistantName: ASSISTANT_NAME,
      chatJid: WEB_MAIN_JID,
      host: '127.0.0.1',
      port,
    });

    logger.info({ url: webUiServer.url }, 'Open Web UI in browser');
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupKey, proc, processName, groupFolder, activeChatJid) =>
      queue.registerProcess(
        groupKey,
        proc,
        processName,
        groupFolder,
        activeChatJid,
      ),
    sendMessage: async (jid, rawText) => {
      await sendOutbound(jid, rawText);
    },
  });

  startIpcWatcher({
    sendMessage: (jid, text) => routeOutbound(channels, jid, text),
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp.syncGroupMetadata(force),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });

  queue.setProcessMessagesFn(processGroupMessages);
  recoverPendingMessages();
  startMessageLoop();
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname ===
    new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
