// iCal service — generate .ics feeds from bookings for calendar integration

function escapeIcal(s: string): string {
  return s.replace(/[\\;,]/g, '\\$&').replace(/\n/g, '\\n');
}

function fmtDate(ymd: string, hms?: string): string {
  // Convert "2026-05-09" + "19:00" → "20260509T190000"
  const date = ymd.replace(/-/g, '');
  if (!hms) return date;
  const time = hms.replace(/:/g, '').padEnd(6, '0');
  return `${date}T${time}`;
}

export function generateIcalFeed(bookings: Array<{
  id: string;
  eventName?: string | null;
  eventType: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  artistId?: string | null;
  venueId?: string | null;
  status: string;
  createdAt: string;
}>, title: string = 'EntEx Bookings'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EntEx//Booking Calendar//EN',
    `X-WR-CALNAME:${escapeIcal(title)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const b of bookings) {
    const uid = `${b.id}@entex`;
    const dtStart = fmtDate(b.eventDate, b.startTime);
    const dtEnd = fmtDate(b.eventDate, b.endTime);
    const summary = escapeIcal(b.eventName ?? `${b.eventType}`);
    const statusMap: Record<string, string> = {
      inquiry: 'TENTATIVE', tentative: 'TENTATIVE',
      confirmed: 'CONFIRMED', contracted: 'CONFIRMED',
      cancelled: 'CANCELLED', completed: 'CONFIRMED',
    };

    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${escapeIcal(b.eventType)} — Status: ${b.status}`,
      `STATUS:${statusMap[b.status] ?? 'TENTATIVE'}`,
      `DTSTAMP:${fmtDate(b.createdAt.slice(0, 10), b.createdAt.slice(11, 19))}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
