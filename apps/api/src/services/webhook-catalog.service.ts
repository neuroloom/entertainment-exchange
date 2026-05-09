// Webhook event catalog — document all event types and their payloads
export interface EventType {
  name: string;
  category: 'business' | 'booking' | 'deal' | 'payment' | 'rights' | 'agent';
  description: string;
  payloadSchema: Record<string, { type: string; description: string }>;
}

const CATALOG: EventType[] = [
  { name: 'business.created', category: 'business', description: 'A new business entity was created', payloadSchema: { id: { type: 'string', description: 'Business ID' }, name: { type: 'string', description: 'Business name' }, vertical: { type: 'string', description: 'Industry vertical' } } },
  { name: 'booking.created', category: 'booking', description: 'A new booking was created', payloadSchema: { id: { type: 'string', description: 'Booking ID' }, eventType: { type: 'string', description: 'Type of event' }, eventDate: { type: 'string', description: 'Event date (ISO)' }, status: { type: 'string', description: 'Booking status' }, quote: { type: 'number', description: 'Quoted amount in cents' } } },
  { name: 'booking.confirmed', category: 'booking', description: 'A booking was confirmed', payloadSchema: { id: { type: 'string', description: 'Booking ID' }, eventType: { type: 'string', description: 'Type of event' }, eventDate: { type: 'string', description: 'Event date (ISO)' }, status: { type: 'string', description: 'New status' } } },
  { name: 'booking.cancelled', category: 'booking', description: 'A booking was cancelled', payloadSchema: { id: { type: 'string', description: 'Booking ID' }, eventDate: { type: 'string', description: 'Event date (ISO)' }, previousStatus: { type: 'string', description: 'Previous status before cancellation' } } },
  { name: 'deal.completed', category: 'deal', description: 'A marketplace deal was completed', payloadSchema: { id: { type: 'string', description: 'Deal ID' }, amountCents: { type: 'number', description: 'Deal amount in cents' }, status: { type: 'string', description: 'Deal status' } } },
  { name: 'payment.received', category: 'payment', description: 'A payment was received', payloadSchema: { id: { type: 'string', description: 'Payment ID' }, amountCents: { type: 'number', description: 'Amount in cents' }, paymentMethod: { type: 'string', description: 'Payment method' } } },
  { name: 'rights.anchored', category: 'rights', description: 'A new rights anchor was created', payloadSchema: { id: { type: 'string', description: 'Anchor ID' }, documentType: { type: 'string', description: 'Type of legal document' } } },
  { name: 'rights.transferred', category: 'rights', description: 'Rights were transferred to a new owner', payloadSchema: { id: { type: 'string', description: 'Transfer ID' }, fromOwnerId: { type: 'string', description: 'Previous owner' }, toOwnerId: { type: 'string', description: 'New owner' } } },
  { name: 'agent.run_completed', category: 'agent', description: 'An agent run completed', payloadSchema: { id: { type: 'string', description: 'Run ID' }, agentId: { type: 'string', description: 'Agent ID' }, status: { type: 'string', description: 'Run outcome' } } },
];

export const webhookCatalog = {
  listCategories(): string[] {
    return [...new Set(CATALOG.map(e => e.category))];
  },

  listByCategory(category?: string): EventType[] {
    return category ? CATALOG.filter(e => e.category === category) : CATALOG;
  },

  getEvent(name: string): EventType | undefined {
    return CATALOG.find(e => e.name === name);
  },

  searchEvents(query: string): EventType[] {
    const q = query.toLowerCase();
    return CATALOG.filter(e => e.name.includes(q) || e.description.toLowerCase().includes(q));
  },
};
