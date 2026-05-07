// RevenueSchedule — tracks deferred→recognized revenue events.
// When an event completes (recognition date passes), the deferred revenue
// can be recognized as Booking Revenue through the RECOGNIZE_RECIPE.

export interface ScheduledRecognition {
  bookingId: string;
  businessId: string;
  amount: number;          // cents
  eventDate: string;       // ISO-8601 — the date the event occurs
  recognized: boolean;
  recognizedAt?: string;   // ISO-8601 — set when recognizeRevenue is called
  createdAt: string;
}

export class RevenueSchedule {
  #entries: Map<string, ScheduledRecognition>;

  constructor() {
    this.#entries = new Map();
  }

  /**
   * Schedule a future revenue recognition.
   * The bookingId ties back to the original journal entry that deferred the revenue.
   */
  scheduleRecognition(
    bookingId: string,
    businessId: string,
    amount: number,
    eventDate: string,
  ): ScheduledRecognition {
    const recognition: ScheduledRecognition = {
      bookingId,
      businessId,
      amount,
      eventDate,
      recognized: false,
      createdAt: new Date().toISOString(),
    };
    this.#entries.set(bookingId, recognition);
    return recognition;
  }

  /**
   * Return all scheduled recognitions for a business whose event date
   * has passed and that have not yet been recognized.
   */
  getRecognizableRevenue(businessId: string): ScheduledRecognition[] {
    const now = new Date();
    const results: ScheduledRecognition[] = [];
    for (const [, entry] of this.#entries) {
      if (entry.businessId !== businessId) continue;
      if (entry.recognized) continue;
      if (new Date(entry.eventDate) <= now) {
        results.push(entry);
      }
    }
    return results;
  }

  /**
   * Mark a scheduled recognition as recognized.
   * Returns the updated entry or throws if the bookingId is not found.
   */
  recognizeRevenue(bookingId: string): ScheduledRecognition {
    const entry = this.#entries.get(bookingId);
    if (!entry) {
      throw new Error(`RevenueSchedule: no entry for bookingId "${bookingId}"`);
    }
    if (entry.recognized) {
      throw new Error(`RevenueSchedule: bookingId "${bookingId}" already recognized`);
    }
    entry.recognized = true;
    entry.recognizedAt = new Date().toISOString();
    return entry;
  }

  /** Return a single scheduled recognition by bookingId, or undefined. */
  get(bookingId: string): ScheduledRecognition | undefined {
    return this.#entries.get(bookingId);
  }

  /** Return all entries (useful for debugging / admin views). */
  all(): ScheduledRecognition[] {
    return Array.from(this.#entries.values());
  }

  /** Number of scheduled entries. */
  get size(): number {
    return this.#entries.size;
  }
}
