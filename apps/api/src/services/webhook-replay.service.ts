// Webhook replay — replay past webhook events from delivery history
interface ReplayEvent { id: string; subscriptionId: string; event: string; payload: unknown; replayedAt: string; originalDeliveryId: string; status: string; }

const replayEvents: ReplayEvent[] = [];

export const webhookReplay = {
  replay(subscriptionId: string, originalDeliveryId: string, event: string, payload: unknown): ReplayEvent {
    const r: ReplayEvent = {
      id: crypto.randomUUID(), subscriptionId, event, payload,
      replayedAt: new Date().toISOString(), originalDeliveryId, status: 'replayed',
    };
    replayEvents.push(r);
    return r;
  },

  replayBatch(subscriptionId: string, deliveries: Array<{ id: string; event: string; payload: unknown }>): { replayed: number; events: ReplayEvent[] } {
    const events: ReplayEvent[] = [];
    for (const d of deliveries) {
      events.push(this.replay(subscriptionId, d.id, d.event, d.payload));
    }
    return { replayed: events.length, events };
  },

  listReplays(subscriptionId?: string): ReplayEvent[] {
    return (subscriptionId ? replayEvents.filter(r => r.subscriptionId === subscriptionId) : replayEvents)
      .sort((a, b) => b.replayedAt.localeCompare(a.replayedAt));
  },

  getReplay(id: string): ReplayEvent | undefined {
    return replayEvents.find(r => r.id === id);
  },
};
