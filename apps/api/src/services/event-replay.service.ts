// Event replay — reconstruct entity state from audit events
export interface ReplayState {
  entityId: string;
  entityType: string;
  currentState: Record<string, unknown>;
  eventCount: number;
  events: Array<{ action: string; timestamp: string; changes: Record<string, unknown> }>;
}

const eventLog: Array<{ entityId: string; entityType: string; action: string; timestamp: string; before?: Record<string, unknown>; after?: Record<string, unknown> }> = [];

export const eventReplay = {
  recordEvent(entityType: string, entityId: string, action: string, before?: Record<string, unknown>, after?: Record<string, unknown>): void {
    eventLog.push({ entityId, entityType, action, timestamp: new Date().toISOString(), before, after });
    if (eventLog.length > 50_000) eventLog.splice(0, eventLog.length - 50_000);
  },

  replay(entityType: string, entityId: string): ReplayState | null {
    const events = eventLog.filter(e => e.entityType === entityType && e.entityId === entityId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (events.length === 0) return null;

    const state: Record<string, unknown> = { ...(events[0].before ?? {}) };
    const timeline: ReplayState['events'] = [];

    for (const e of events) {
      if (e.after) Object.assign(state, e.after);
      timeline.push({ action: e.action, timestamp: e.timestamp, changes: e.after ?? {} });
    }

    return { entityId, entityType, currentState: state, eventCount: events.length, events: timeline };
  },

  getTimeline(entityType: string, entityId: string): ReplayState['events'] {
    return eventLog
      .filter(e => e.entityType === entityType && e.entityId === entityId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .map(e => ({ action: e.action, timestamp: e.timestamp, changes: e.after ?? {} }));
  },
};
