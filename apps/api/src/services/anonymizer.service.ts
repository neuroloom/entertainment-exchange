// Data anonymizer — generate privacy-safe test data or sanitize exports
const FIRST_NAMES = ['Alex', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Taylor', 'Quinn', 'Avery', 'Blake', 'Cameron', 'Dakota', 'Ellis', 'Finley', 'Gray', 'Harper'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson'];
const COMPANIES = ['Acme Entertainment', 'Stellar Events', 'Premier Talent', 'Apex Productions', 'Vertex Media', 'Nexus Creative', 'Horizon Arts', 'Pulse Live'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function hashId(id: string): string { return `anon_${id.slice(0, 8)}`; }
function fakeEmail(name: string): string { return `${name.toLowerCase().replace(/\s/g, '.')}@example.com`; }
function fakeDate(base: Date, offsetDays: number): string { const d = new Date(base); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); }

export const anonymizer = {
  anonymizeEntity(entity: Record<string, unknown>, type: string): Record<string, unknown> {
    const out = { ...entity };
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;

    // Scrub PII fields
    const piiFields = ['name', 'legalName', 'eventName', 'email', 'phone', 'clientId', 'userId', 'uploadedBy', 'actorId', 'artistId'];
    for (const f of piiFields) {
      if (f in out) {
        if (f === 'legalName' || f === 'name') out[f] = type === 'business' ? pick(COMPANIES) : name;
        else if (f === 'eventName') out[f] = `${pick(['Summer', 'Winter', 'Spring', 'Fall'])} ${pick(['Fest', 'Showcase', 'Tour', 'Gala', 'Concert'])}`;
        else if (f === 'email') out[f] = fakeEmail(name);
        else out[f] = hashId(String(out[f] ?? ''));
      }
    }

    // Scrub metadata
    if (out.metadata && typeof out.metadata === 'object') out.metadata = {};

    // Prefix IDs for anonymity
    if (out.id) out.id = hashId(String(out.id));
    if (out.tenantId) out.tenantId = 'anon-tenant';

    return out;
  },

  anonymizeDataset(records: Record<string, unknown>[], type: string): Record<string, unknown>[] {
    return records.map(r => this.anonymizeEntity(r, type));
  },

  generateFakeBusiness(): Record<string, unknown> {
    return {
      id: crypto.randomUUID(), tenantId: 'anon-tenant', name: pick(COMPANIES),
      vertical: pick(['entertainment', 'music', 'sports', 'theater']),
      legalName: `${pick(COMPANIES)} LLC`, status: 'active', currency: 'USD',
      timezone: 'America/New_York', metadata: {},
      createdAt: fakeDate(new Date(), -90), updatedAt: fakeDate(new Date(), -1),
    };
  },

  generateFakeBooking(): Record<string, unknown> {
    return {
      id: crypto.randomUUID(), tenantId: 'anon-tenant', businessId: crypto.randomUUID(),
      eventType: pick(['concert', 'comedy', 'theater', 'dance', 'festival']),
      eventName: `${pick(['Summer', 'Winter'])} ${pick(['Fest', 'Showcase'])}`,
      eventDate: fakeDate(new Date(), Math.floor(Math.random() * 60) + 1),
      startTime: '19:00', endTime: '22:00', status: pick(['confirmed', 'completed', 'inquiry']),
      quotedAmountCents: Math.floor(Math.random() * 50_000) + 5000,
      metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  },
};
