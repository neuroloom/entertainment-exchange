// Booking state machine — state definitions, transition validation, and terminal checks

export const BOOKING_STATES = [
  'inquiry',
  'tentative',
  'confirmed',
  'contracted',
  'completed',
  'cancelled',
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

export const ALLOWED_TRANSITIONS: ReadonlyMap<BookingState, readonly BookingState[]> = new Map([
  ['inquiry', ['tentative', 'cancelled']],
  ['tentative', ['confirmed', 'cancelled', 'inquiry']],
  ['confirmed', ['contracted', 'cancelled', 'tentative']],
  ['contracted', ['completed', 'cancelled']],
  ['completed', []],
  ['cancelled', []],
]);

const TERMINAL_STATES: ReadonlySet<BookingState> = new Set(['completed', 'cancelled']);

/**
 * A lightweight error class compatible with the API's AppError interface.
 * Used within the orchestration package to avoid a dependency on apps/api.
 */
export class BookingStateError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INVALID_TRANSITION',
    public readonly status: number = 400,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'BookingStateError';
  }
}

/**
 * Asserts that a state transition is valid. Throws if it is not.
 * Provides a descriptive reason in the error when a transition is rejected.
 */
export function assertBookingTransition(
  from: BookingState,
  to: BookingState,
  reason?: string,
): void {
  if (from === to) {
    return; // no-op transition is allowed
  }

  const allowed = ALLOWED_TRANSITIONS.get(from);
  if (!allowed || !allowed.includes(to)) {
    const baseMessage = `Invalid booking transition from "${from}" to "${to}"`;
    const detailMessage = reason ? `${baseMessage}: ${reason}` : baseMessage;

    // Provide a hint when the target is a terminal state and the source isn't ready
    if (TERMINAL_STATES.has(to) && from !== 'contracted' && to === 'completed') {
      throw new BookingStateError(
        `${detailMessage}. Bookings can only be completed from the "contracted" state.`,
        'INVALID_TRANSITION',
        400,
        { from, to, allowed: allowed ?? [] },
      );
    }

    throw new BookingStateError(detailMessage, 'INVALID_TRANSITION', 400, {
      from,
      to,
      allowed: allowed ?? [],
    });
  }
}

/** Returns true when the state is terminal (completed or cancelled). */
export function isTerminalState(state: BookingState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Returns the list of allowed next states from the given state. */
export function getNextStates(state: BookingState): readonly BookingState[] {
  return ALLOWED_TRANSITIONS.get(state) ?? [];
}
