export type SessionType = "direct" | "room";

export interface ParsedSession {
  type: SessionType;
  id: string;
  prefix: string;
}

export function buildSessionId(type: SessionType, id: string, prefix: string): string {
  return `${prefix}:${type}:${id}`;
}

export function parseSessionId(sessionId: string): ParsedSession | null {
  const parts = sessionId.split(":");
  if (parts.length !== 3) return null;
  const [prefix, type, id] = parts;
  if (type !== "direct" && type !== "room") return null;
  if (!prefix || !id) return null;
  return { type, id, prefix };
}
