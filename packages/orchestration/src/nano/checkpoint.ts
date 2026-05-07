// NanoClaw Checkpoint System — DBOS-style execution checkpoints
// Ported from neuroloom-nano/orchestration/checkpoint.py
// In-memory implementation (no SQLite dep in TypeScript; swap to better-sqlite3 if needed)

import type { CheckpointEntry, CheckpointSummary, SessionSummary } from './types.js';

/** In-memory checkpoint store (keep-alive: 10k entries) */
class CheckpointStore {
  private entries: CheckpointEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10000) { this.maxEntries = maxEntries; }

  save(entry: CheckpointEntry): void {
    // Replace existing entry for same (sessionId, step) or append
    const idx = this.entries.findIndex(e => e.sessionId === entry.sessionId && e.step === entry.step);
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
    // Prune oldest if over limit
    while (this.entries.length > this.maxEntries) this.entries.shift();
  }

  loadLatest(sessionId: string): CheckpointEntry | null {
    const session = this.entries.filter(e => e.sessionId === sessionId);
    if (session.length === 0) return null;
    return session.reduce((max, e) => e.step > max.step ? e : max);
  }

  loadByStep(sessionId: string, step: number): CheckpointEntry | null {
    return this.entries.find(e => e.sessionId === sessionId && e.step === step) ?? null;
  }

  listCheckpoints(sessionId: string, limit = 20): CheckpointSummary[] {
    return this.entries
      .filter(e => e.sessionId === sessionId)
      .sort((a, b) => b.step - a.step)
      .slice(0, limit)
      .map(e => ({
        step: e.step,
        timestamp: e.timestamp,
        functionName: e.functionName,
        messagesSize: JSON.stringify(e.messages).length,
        resultPreview: JSON.stringify(e.result).slice(0, 100),
      }));
  }

  listSessions(): SessionSummary[] {
    const sessions = new Map<string, { steps: number; lastTs: number }>();
    for (const e of this.entries) {
      const s = sessions.get(e.sessionId);
      if (!s) sessions.set(e.sessionId, { steps: 1, lastTs: e.timestamp });
      else { s.steps++; if (e.timestamp > s.lastTs) s.lastTs = e.timestamp; }
    }
    return [...sessions.entries()]
      .map(([sessionId, { steps, lastTs }]) => ({ sessionId, steps, lastTimestamp: lastTs }))
      .sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  }

  get size(): number { return this.entries.length; }
}

/** Shared singleton store */
const store = new CheckpointStore();

/** Save a full conversation checkpoint */
export function saveCheckpoint(
  sessionId: string,
  step: number,
  messages: unknown[],
  result: unknown,
  state: Record<string, unknown> = {},
  functionName = '',
): void {
  store.save({
    step,
    timestamp: Date.now() / 1000,
    sessionId,
    functionName,
    messages: structuredClone(messages),
    result: structuredClone(result),
    state: structuredClone(state),
  });
}

/** Load the most recent checkpoint for a session */
export function loadLatestCheckpoint(sessionId: string): CheckpointEntry | null {
  return store.loadLatest(sessionId);
}

/** Load a checkpoint by step number */
export function loadCheckpointByStep(sessionId: string, step: number): CheckpointEntry | null {
  return store.loadByStep(sessionId, step);
}

/** List recent checkpoints for a session */
export function listCheckpoints(sessionId: string, limit = 20): CheckpointSummary[] {
  return store.listCheckpoints(sessionId, limit);
}

/** List all sessions with checkpoints */
export function listSessions(): SessionSummary[] {
  return store.listSessions();
}

/** Resume the most recent session */
export function resumeLatestSession(): (CheckpointEntry & { sessionId: string }) | null {
  const sessions = store.listSessions();
  if (sessions.length === 0) return null;
  const latest = sessions[0];
  const cp = store.loadLatest(latest.sessionId);
  if (!cp) return null;
  return { ...cp, sessionId: latest.sessionId };
}

/** Get total checkpoint count */
export function checkpointCount(): number {
  return store.size;
}
