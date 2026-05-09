// Realtime event service — SSE push for live UI updates
// Lightweight publish/subscribe without external dependencies

export interface RealtimeEvent {
  id: string;
  type: string;
  tenantId: string;
  data: unknown;
  timestamp: string;
}

type SSEClient = (event: RealtimeEvent) => void;

interface TenantRoom {
  clients: Set<SSEClient>;
  recentEvents: RealtimeEvent[];  // Replay buffer for late joiners
}

const rooms = new Map<string, TenantRoom>();
const MAX_REPLAY = 50;
const MAX_CLIENTS_PER_TENANT = 100;

function getRoom(tenantId: string): TenantRoom {
  let room = rooms.get(tenantId);
  if (!room) {
    room = { clients: new Set(), recentEvents: [] };
    rooms.set(tenantId, room);
  }
  return room;
}

export const realtime = {
  subscribe(tenantId: string, callback: SSEClient): () => void {
    const room = getRoom(tenantId);
    if (room.clients.size >= MAX_CLIENTS_PER_TENANT) {
      callback({ id: '', type: 'error', tenantId, data: { message: 'Too many connections' }, timestamp: new Date().toISOString() });
      return () => {};
    }
    room.clients.add(callback);

    // Replay recent events
    for (const event of room.recentEvents) {
      callback(event);
    }

    return () => { room.clients.delete(callback); };
  },

  publish(tenantId: string, type: string, data: unknown): void {
    const room = rooms.get(tenantId);
    if (!room || room.clients.size === 0) return;

    const event: RealtimeEvent = {
      id: `${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type, tenantId, data, timestamp: new Date().toISOString(),
    };

    // Store in replay buffer
    room.recentEvents.push(event);
    if (room.recentEvents.length > MAX_REPLAY) room.recentEvents.shift();

    // Broadcast to all clients in the room
    for (const client of room.clients) {
      try { client(event); } catch { /* dead client - will be cleaned on next subscribe */ }
    }
  },

  getStats(): { tenants: number; totalClients: number } {
    let totalClients = 0;
    for (const room of rooms.values()) totalClients += room.clients.size;
    return { tenants: rooms.size, totalClients };
  },

  disconnectTenant(tenantId: string): void {
    rooms.delete(tenantId);
  },
};
