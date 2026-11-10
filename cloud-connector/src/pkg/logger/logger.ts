import pino from 'pino';
import os from 'node:os';

let pretty = false;
try {
  pretty = process.env.LOG_PRETTY === '1';
} catch {
  // ignore
}

const pinoFn = pino as unknown as (opts: unknown) => pino.Logger;

export const logger = pinoFn({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: pretty
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      }
    : undefined,
  base: { pid: process.pid, hostname: os.hostname() },
  redact: ['req.headers.authorization', 'res.headers.authorization', 'config.connector.apiKey', 'config.connector.webhookSecret', 'password', 'token', 'secret'],
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = pino.Logger;

export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}




