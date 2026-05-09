// Conflict detector — prevents double-bookings for artists and venues
// Checks time overlap with configurable buffer between events

export interface TimeWindow {
  eventDate: string;
  startTime: string;
  endTime: string;
  bufferMinutes?: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  conflicts: Array<{
    bookingId: string;
    resourceType: 'artist' | 'venue';
    resourceId: string;
    eventDate: string;
    startTime: string;
    endTime: string;
    overlap: 'full' | 'partial' | 'edge';
  }>;
}

function toMinutes(isoDate: string, time: string): number {
  // time is HH:MM or HH:MM:SS
  const [h, m] = time.split(':').map(Number);
  const d = new Date(isoDate);
  return d.getTime() / 60000 + h * 60 + m;
}

function overlapType(aStart: number, aEnd: number, bStart: number, bEnd: number): 'full' | 'partial' | 'edge' | null {
  if (aEnd <= bStart || bEnd <= aStart) return null;
  if (aStart >= bStart && aEnd <= bEnd) return 'full';
  if (aStart <= bStart && aEnd >= bEnd) return 'full';
  if (aStart === bEnd || aEnd === bStart) return 'edge';
  return 'partial';
}

export function detectConflicts(
  proposed: TimeWindow,
  existingBookings: Array<{
    id: string;
    artistId?: string | null;
    venueId?: string | null;
    eventDate: string;
    startTime: string;
    endTime: string;
  }>,
  relevantArtistId?: string | null,
  relevantVenueId?: string | null,
): ConflictResult {
  const buffer = (proposed.bufferMinutes ?? 60);
  const pStart = toMinutes(proposed.eventDate, proposed.startTime) - buffer;
  const pEnd = toMinutes(proposed.eventDate, proposed.endTime) + buffer;
  const conflicts: ConflictResult['conflicts'] = [];

  for (const b of existingBookings) {
    const bStart = toMinutes(b.eventDate, b.startTime);
    const bEnd = toMinutes(b.eventDate, b.endTime);

    // Only check same-date or adjacent dates (within 24h either side)
    const dayDiff = Math.abs(new Date(proposed.eventDate).getTime() - new Date(b.eventDate).getTime());
    if (dayDiff > 24 * 60 * 60 * 1000) continue;

    if (relevantArtistId && b.artistId === relevantArtistId) {
      const overlap = overlapType(pStart, pEnd, bStart, bEnd);
      if (overlap) conflicts.push({ bookingId: b.id, resourceType: 'artist', resourceId: b.artistId, eventDate: b.eventDate, startTime: b.startTime, endTime: b.endTime, overlap });
    }
    if (relevantVenueId && b.venueId === relevantVenueId) {
      const overlap = overlapType(pStart, pEnd, bStart, bEnd);
      if (overlap) conflicts.push({ bookingId: b.id, resourceType: 'venue', resourceId: b.venueId, eventDate: b.eventDate, startTime: b.startTime, endTime: b.endTime, overlap });
    }
  }

  return { hasConflict: conflicts.length > 0, conflicts };
}
