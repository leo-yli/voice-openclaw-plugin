export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatMessage(level: LogLevel, tag: string, msg: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] [${level.toUpperCase()}] [museve-voice:${tag}] ${msg}`;
}

export function createLogger(tag: string) {
  return {
    debug(msg: string, ...args: unknown[]) {
      if (shouldLog("debug")) console.debug(formatMessage("debug", tag, msg), ...args);
    },
    info(msg: string, ...args: unknown[]) {
      if (shouldLog("info")) console.info(formatMessage("info", tag, msg), ...args);
    },
    warn(msg: string, ...args: unknown[]) {
      if (shouldLog("warn")) console.warn(formatMessage("warn", tag, msg), ...args);
    },
    error(msg: string, ...args: unknown[]) {
      if (shouldLog("error")) console.error(formatMessage("error", tag, msg), ...args);
    },
  };
}
