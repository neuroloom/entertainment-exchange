// Webhook batcher — aggregate events before delivery for efficiency
interface BatchedEvent {
  tenantId: string;
  subscriptionId: string;
  events: Array<{ event: string; timestamp: string; data: unknown }>;
  sequenceStart: number;
  batchSize: number;
}

const batches = new Map<string, BatchedEvent>();
const MAX_BATCH_SIZE = 20;
const MAX_BATCH_DELAY_MS = 5_000; // 5 seconds

export const webhookBatcher = {
  addEvent(subscriptionId: string, tenantId: string, event: string, data: unknown): BatchedEvent | null {
    let batch = batches.get(subscriptionId);
    if (!batch) {
      batch = { tenantId, subscriptionId, events: [], sequenceStart: Date.now(), batchSize: 0 };
      batches.set(subscriptionId, batch);
    }

    batch.events.push({ event, timestamp: new Date().toISOString(), data });
    batch.batchSize++;

    if (batch.batchSize >= MAX_BATCH_SIZE) {
      return this.flush(subscriptionId);
    }

    // Auto-flush after delay
    const elapsed = Date.now() - batch.sequenceStart;
    if (elapsed >= MAX_BATCH_DELAY_MS) {
      return this.flush(subscriptionId);
    }

    return null;
  },

  flush(subscriptionId: string): BatchedEvent | null {
    const batch = batches.get(subscriptionId);
    if (!batch || batch.batchSize === 0) return null;
    batches.delete(subscriptionId);
    return batch;
  },

  flushAll(): BatchedEvent[] {
    const result: BatchedEvent[] = [];
    for (const [id] of batches) {
      const batch = this.flush(id);
      if (batch) result.push(batch);
    }
    return result;
  },

  getPending(): number {
    let total = 0;
    for (const batch of batches.values()) total += batch.batchSize;
    return total;
  },
};
