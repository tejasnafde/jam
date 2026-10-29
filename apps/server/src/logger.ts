// Structured JSON logs, one object per line, in the shape Cloud Logging
// parses (`severity`, `message`). Never pass tokens or request headers here.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type Fields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
}

export function createLogger(minLevel: Level = "info", write: (line: string) => void = (l) => console.log(l)): Logger {
  const emit = (level: Level, message: string, fields: Fields = {}) => {
    if (ORDER[level] < ORDER[minLevel]) return;
    write(JSON.stringify({ severity: level.toUpperCase(), message, time: new Date().toISOString(), ...fields }));
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export function errorFields(err: unknown): Fields {
  return err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) };
}
