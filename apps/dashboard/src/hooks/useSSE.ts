import { useEffect, useRef, useCallback, useState } from 'react';

export interface RealtimeEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export function useSSE(tenantId: string | null) {
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (!tenantId) return;
    if (sourceRef.current) sourceRef.current.close();

    const es = new window.EventSource(`/api/v1/realtime/stream`);
    sourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };
    es.addEventListener('message', (e) => {
      try {
        const event: RealtimeEvent = JSON.parse(e.data);
        setEvents(prev => [event, ...prev].slice(0, 100));
      } catch { /* skip malformed */ }
    });
  }, [tenantId]);

  useEffect(() => {
    connect();
    return () => {
      if (sourceRef.current) sourceRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { events, connected, latest: events[0] };
}
