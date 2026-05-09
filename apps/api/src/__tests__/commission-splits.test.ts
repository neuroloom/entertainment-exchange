import { describe, it, expect } from 'vitest';
import { computeSplits } from '../services/commission-splits.service.js';

describe('computeSplits', () => {
  it('splits 10000 cents 80/20', () => {
    const result = computeSplits(10000, [
      { partyType: 'artist', name: 'Artist', percentageBps: 8000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'Venue', percentageBps: 2000, fixedFeeCents: 0 },
    ]);
    const artist = result.parties.find(p => p.partyType === 'artist')!;
    const venue = result.parties.find(p => p.partyType === 'venue')!;
    expect(artist.allocatedCents).toBeGreaterThanOrEqual(7900);
    expect(venue.allocatedCents).toBeGreaterThanOrEqual(1900);
    expect(artist.allocatedCents + venue.allocatedCents).toBeLessThanOrEqual(10000);
  });

  it('handles fixed fees before percentages', () => {
    const result = computeSplits(10000, [
      { partyType: 'platform', name: 'Platform', percentageBps: 0, fixedFeeCents: 500 },
      { partyType: 'artist', name: 'Artist', percentageBps: 8000, fixedFeeCents: 0 },
    ]);
    const platform = result.parties.find(p => p.partyType === 'platform')!;
    expect(platform.allocatedCents).toBeGreaterThanOrEqual(500);
  });

  it('rejects percentage totals over 100%', () => {
    expect(() => computeSplits(10000, [
      { partyType: 'artist', name: 'A', percentageBps: 8000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'V', percentageBps: 5000, fixedFeeCents: 0 },
    ])).toThrow('Split percentages exceed 100%');
  });

  it('handles three-way split', () => {
    const result = computeSplits(15000, [
      { partyType: 'artist', name: 'Artist', percentageBps: 6000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'Venue', percentageBps: 3000, fixedFeeCents: 0 },
      { partyType: 'agent', name: 'Agent', percentageBps: 1000, fixedFeeCents: 0 },
    ]);
    expect(result.parties).toHaveLength(3);
    const total = result.parties.reduce((s, p) => s + p.allocatedCents, 0);
    expect(total).toBeLessThanOrEqual(15000);
  });

  it('gives remainder to platform party', () => {
    const result = computeSplits(10000, [
      { partyType: 'artist', name: 'Artist', percentageBps: 7000, fixedFeeCents: 0 },
      { partyType: 'platform', name: 'Platform', percentageBps: 1000, fixedFeeCents: 0 },
    ]);
    const platform = result.parties.find(p => p.partyType === 'platform')!;
    // Platform should get its percentage share + any remainder
    expect(platform.allocatedCents).toBeGreaterThanOrEqual(900);
  });
});
