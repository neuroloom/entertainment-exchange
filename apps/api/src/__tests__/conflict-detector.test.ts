import { describe, it, expect } from 'vitest';
import { detectConflicts } from '../services/conflict-detector.service.js';

const bk = (id: string, artistId?: string, venueId?: string, date = '2026-05-15', start = '19:00', end = '22:00') => ({
  id, artistId: artistId ?? null as string | null, venueId: venueId ?? null as string | null,
  eventDate: date, startTime: start, endTime: end,
});

describe('detectConflicts', () => {
  it('detects no conflicts for non-overlapping bookings', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'artist-1', 'venue-1', '2026-05-15', '14:00', '16:00')],
      'artist-1', 'venue-1',
    );
    expect(result.hasConflict).toBe(false);
  });

  it('detects artist overlap on same day', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'artist-1', undefined, '2026-05-15', '20:00', '23:00')],
      'artist-1', undefined,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflicts[0].resourceType).toBe('artist');
  });

  it('detects venue overlap on same day', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', undefined, 'venue-1', '2026-05-15', '18:00', '21:00')],
      undefined, 'venue-1',
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflicts[0].resourceType).toBe('venue');
  });

  it('respects buffer time (default 60min)', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'artist-1', undefined, '2026-05-15', '22:30', '23:30')],
      'artist-1', undefined,
    );
    expect(result.hasConflict).toBe(true);
  });

  it('returns empty conflicts for different artists/venues', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'other-artist', 'other-venue', '2026-05-15', '19:00', '22:00')],
      'artist-1', 'venue-1',
    );
    expect(result.hasConflict).toBe(false);
  });

  it('ignores bookings more than 24h apart', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'artist-1', undefined, '2026-05-17', '19:00', '22:00')],
      'artist-1', undefined,
    );
    expect(result.hasConflict).toBe(false);
  });

  it('classifies overlap types', () => {
    const result = detectConflicts(
      { eventDate: '2026-05-15', startTime: '19:00', endTime: '22:00' },
      [bk('b1', 'artist-1', undefined, '2026-05-15', '18:00', '23:00')],
      'artist-1', undefined,
    );
    expect(result.hasConflict).toBe(true);
    expect(result.conflicts[0].overlap).toBe('full');
  });
});
