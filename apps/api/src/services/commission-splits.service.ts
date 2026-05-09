// Commission splits — multi-party payout calculation for bookings
// Artist/venue/agent splits with configurable percentages and fixed fees

export interface SplitParty {
  partyType: 'artist' | 'venue' | 'agent' | 'platform';
  partyId?: string;
  name: string;
  percentageBps: number;  // basis points (10000 = 100%)
  fixedFeeCents: number;
}

export interface SplitResult {
  totalCents: number;
  parties: Array<SplitParty & { allocatedCents: number }>;
  roundingCents: number;  // remainder from integer division
}

export function computeSplits(totalCents: number, parties: SplitParty[]): SplitResult {
  // Validate percentages
  const totalBps = parties.reduce((s, p) => s + p.percentageBps, 0);
  if (totalBps > 10000) throw new Error(`Split percentages exceed 100% (${totalBps / 100}%)`);

  let remaining = totalCents;
  const allocated: SplitResult['parties'] = [];

  // Fixed fees first
  for (const party of parties) {
    const fixed = Math.min(party.fixedFeeCents, remaining);
    remaining -= fixed;
    allocated.push({ ...party, allocatedCents: fixed });
  }

  // Percentage allocations from remaining
  for (let i = 0; i < parties.length; i++) {
    if (parties[i].percentageBps > 0) {
      const pctShare = Math.floor(totalCents * parties[i].percentageBps / 10000);
      const afterFixed = allocated[i].allocatedCents;
      // The percentage applies to the gross, but fixed fees come out first
      const adjusted = Math.max(0, pctShare - afterFixed);
      allocated[i].allocatedCents += adjusted;
      remaining -= adjusted;
    }
  }

  // Platform takes the remainder (or it goes to rounding)
  // Distribute remainder to first non-zero party
  if (remaining > 0) {
    const idx = allocated.findIndex(p => p.partyType === 'platform');
    if (idx >= 0) {
      allocated[idx].allocatedCents += remaining;
    }
  }

  return { totalCents, parties: allocated, roundingCents: remaining };
}

// Common split templates
export const SPLIT_TEMPLATES = {
  artist80_venue20: (totalCents: number): SplitResult =>
    computeSplits(totalCents, [
      { partyType: 'artist', name: 'Artist', percentageBps: 8000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'Venue', percentageBps: 2000, fixedFeeCents: 0 },
    ]),

  artist60_venue30_agent10: (totalCents: number): SplitResult =>
    computeSplits(totalCents, [
      { partyType: 'artist', name: 'Artist', percentageBps: 6000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'Venue', percentageBps: 3000, fixedFeeCents: 0 },
      { partyType: 'agent', name: 'Agent', percentageBps: 1000, fixedFeeCents: 0 },
    ]),

  artist70_venue20_platform10: (totalCents: number): SplitResult =>
    computeSplits(totalCents, [
      { partyType: 'artist', name: 'Artist', percentageBps: 7000, fixedFeeCents: 0 },
      { partyType: 'venue', name: 'Venue', percentageBps: 2000, fixedFeeCents: 0 },
      { partyType: 'platform', name: 'Platform', percentageBps: 1000, fixedFeeCents: 0 },
    ]),
};
