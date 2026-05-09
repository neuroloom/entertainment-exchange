import { useState } from 'react';
import { DndContext, DragEndEvent, closestCorners, useDraggable, useDroppable } from '@dnd-kit/core';
import type { Booking } from '../lib/api';

const COLUMNS = ['inquiry', 'tentative', 'confirmed', 'contracted', 'completed', 'cancelled'] as const;

const COLUMN_LABELS: Record<string, string> = {
  inquiry: 'Inquiry', tentative: 'Tentative', confirmed: 'Confirmed',
  contracted: 'Contracted', completed: 'Completed', cancelled: 'Cancelled',
};

const COLUMN_COLORS: Record<string, string> = {
  inquiry: 'bg-slate-100 border-slate-300', tentative: 'bg-amber-50 border-amber-300',
  confirmed: 'bg-blue-50 border-blue-300', contracted: 'bg-purple-50 border-purple-300',
  completed: 'bg-green-50 border-green-300', cancelled: 'bg-red-50 border-red-300',
};

function BookingCard({ booking }: { booking: Booking }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: booking.id, data: booking });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 10 } : undefined;

  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      className={`p-3 bg-white rounded border shadow-sm cursor-grab active:cursor-grabbing text-sm ${isDragging ? 'opacity-50 shadow-lg' : 'hover:shadow-md'} transition-shadow`}
      style={style}>
      <div className="font-medium truncate">{booking.eventName ?? booking.eventType}</div>
      <div className="text-slate-500 text-xs mt-1">{new Date(booking.eventDate).toLocaleDateString()}</div>
      {booking.quotedAmountCents != null && (
        <div className="text-slate-700 font-mono text-xs mt-1">${(booking.quotedAmountCents / 100).toFixed(2)}</div>
      )}
    </div>
  );
}

function Column({ id, bookings }: { id: string; bookings: Booking[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef}
      className={`flex-shrink-0 w-64 min-h-[60vh] rounded-lg border-2 p-3 flex flex-col gap-2 ${COLUMN_COLORS[id] ?? 'bg-gray-50 border-gray-200'} ${isOver ? 'ring-2 ring-indigo-400' : ''}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">{COLUMN_LABELS[id] ?? id}</span>
        <span className="text-xs bg-white rounded-full px-2 py-0.5 border">{bookings.length}</span>
      </div>
      {bookings.map(b => <BookingCard key={b.id} booking={b} />)}
      {bookings.length === 0 && <div className="text-slate-400 text-xs text-center mt-8">Drop bookings here</div>}
    </div>
  );
}

export function KanbanBoard({ bookings, onMove }: { bookings: Booking[]; onMove: (bookingId: string, newStatus: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  async function handleDragEnd(event: DragEndEvent) {
    setError(null);
    const { active, over } = event;
    if (!over) return;
    const booking = active.data.current as Booking | undefined;
    if (!booking || booking.status === over.id) return;
    try {
      onMove(booking.id, over.id as string);
    } catch {
      setError('Failed to update booking status');
    }
  }

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">{error}</div>}
      <DndContext collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map(col => (
            <Column key={col} id={col} bookings={bookings.filter(b => b.status === col)} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
