import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

// Recoverable WebSocket errors from the ws library — Baileys will reconnect
// on its own after the socket closes, so there's no need to crash the process.
const WS_RECOVERABLE_CODES = new Set([
  'WS_ERR_INVALID_CLOSE_CODE',
  'WS_ERR_INVALID_OPCODE',
  'WS_ERR_INVALID_UTF8',
  'WS_ERR_UNEXPECTED_MASK',
  'WS_ERR_UNEXPECTED_RSV_1',
  'WS_ERR_UNEXPECTED_RSV_2_3',
]);

// Route uncaught errors through pino so they get timestamps in stderr
process.on('uncaughtException', (err: Error & { code?: string }) => {
  if (err.code && WS_RECOVERABLE_CODES.has(err.code)) {
    logger.warn({ err }, 'Recoverable WebSocket error — Baileys will reconnect');
    return;
  }
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});
