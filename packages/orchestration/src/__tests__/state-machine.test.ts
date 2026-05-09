// Booking state machine tests — all valid and invalid transitions
import { describe, it, expect } from 'vitest';
import {
  BOOKING_STATES,
  assertBookingTransition,
  isTerminalState,
  getNextStates,
  BookingStateError,
} from '../booking/state-machine.js';
import type { BookingState } from '../booking/state-machine.js';

describe('BOOKING_STATES', () => {
  it('contains all 7 expected states', () => {
    expect(BOOKING_STATES).toEqual([
      'inquiry',
      'tentative',
      'confirmed',
      'contracted',
      'completed',
      'cancelled',
      'refunded',
    ]);
  });
});

describe('assertBookingTransition — valid transitions', () => {
  it('inquiry → tentative is valid', () => {
    expect(() => assertBookingTransition('inquiry', 'tentative')).not.toThrow();
  });

  it('inquiry → cancelled is valid', () => {
    expect(() => assertBookingTransition('inquiry', 'cancelled')).not.toThrow();
  });

  it('tentative → confirmed is valid', () => {
    expect(() => assertBookingTransition('tentative', 'confirmed')).not.toThrow();
  });

  it('tentative → cancelled is valid', () => {
    expect(() => assertBookingTransition('tentative', 'cancelled')).not.toThrow();
  });

  it('tentative → inquiry is valid', () => {
    expect(() => assertBookingTransition('tentative', 'inquiry')).not.toThrow();
  });

  it('confirmed → contracted is valid', () => {
    expect(() => assertBookingTransition('confirmed', 'contracted')).not.toThrow();
  });

  it('confirmed → cancelled is valid', () => {
    expect(() => assertBookingTransition('confirmed', 'cancelled')).not.toThrow();
  });

  it('confirmed → tentative is valid', () => {
    expect(() => assertBookingTransition('confirmed', 'tentative')).not.toThrow();
  });

  it('contracted → completed is valid', () => {
    expect(() => assertBookingTransition('contracted', 'completed')).not.toThrow();
  });

  it('contracted → cancelled is valid', () => {
    expect(() => assertBookingTransition('contracted', 'cancelled')).not.toThrow();
  });

  it('cancelled → refunded is valid', () => {
    expect(() => assertBookingTransition('cancelled', 'refunded')).not.toThrow();
  });

  it('same-state transition is a no-op (always valid)', () => {
    expect(() => assertBookingTransition('inquiry', 'inquiry')).not.toThrow();
    expect(() => assertBookingTransition('completed', 'completed')).not.toThrow();
    expect(() => assertBookingTransition('refunded', 'refunded')).not.toThrow();
  });
});

describe('assertBookingTransition — invalid transitions', () => {
  it('inquiry → completed is invalid', () => {
    expect(() => assertBookingTransition('inquiry', 'completed')).toThrow(BookingStateError);
    try {
      assertBookingTransition('inquiry', 'completed');
    } catch (err) {
      const e = err as BookingStateError;
      expect(e.code).toBe('INVALID_TRANSITION');
      expect(e.message).toContain('"inquiry" to "completed"');
      expect(e.message).toContain('only be completed from the "contracted" state');
      expect(e.status).toBe(400);
      expect(e.details).toEqual({ from: 'inquiry', to: 'completed', allowed: ['tentative', 'cancelled'] });
    }
  });

  it('inquiry → contracted is invalid', () => {
    expect(() => assertBookingTransition('inquiry', 'contracted')).toThrow(BookingStateError);
  });

  it('inquiry → refunded is invalid', () => {
    expect(() => assertBookingTransition('inquiry', 'refunded')).toThrow(BookingStateError);
  });

  it('tentative → completed is invalid', () => {
    expect(() => assertBookingTransition('tentative', 'completed')).toThrow(BookingStateError);
  });

  it('tentative → refunded is invalid', () => {
    expect(() => assertBookingTransition('tentative', 'refunded')).toThrow(BookingStateError);
  });

  it('confirmed → refunded is invalid', () => {
    expect(() => assertBookingTransition('confirmed', 'refunded')).toThrow(BookingStateError);
  });

  it('contracted → inquiry is invalid', () => {
    expect(() => assertBookingTransition('contracted', 'inquiry')).toThrow(BookingStateError);
  });

  it('contracted → tentative is invalid', () => {
    expect(() => assertBookingTransition('contracted', 'tentative')).toThrow(BookingStateError);
  });

  it('completed → cancelled is invalid (terminal state)', () => {
    expect(() => assertBookingTransition('completed', 'cancelled')).toThrow(BookingStateError);
    try {
      assertBookingTransition('completed', 'cancelled');
    } catch (err) {
      const e = err as BookingStateError;
      expect(e.code).toBe('INVALID_TRANSITION');
      expect(e.status).toBe(400);
      expect(e.details.allowed).toEqual([]);
    }
  });

  it('refunded → anything is invalid (terminal state)', () => {
    expect(() => assertBookingTransition('refunded', 'cancelled')).toThrow(BookingStateError);
    expect(() => assertBookingTransition('refunded', 'inquiry')).toThrow(BookingStateError);
    expect(() => assertBookingTransition('refunded', 'completed')).toThrow(BookingStateError);
  });

  it('cancelled → inquiry is invalid (not in allowed list)', () => {
    expect(() => assertBookingTransition('cancelled', 'inquiry')).toThrow(BookingStateError);
  });

  it('cancelled → completed is invalid', () => {
    expect(() => assertBookingTransition('cancelled', 'completed')).toThrow(BookingStateError);
  });

  it('error includes reason when provided', () => {
    try {
      assertBookingTransition('inquiry', 'confirmed', 'Must be tentative first');
    } catch (err) {
      const e = err as BookingStateError;
      expect(e.message).toContain('Must be tentative first');
    }
  });
});

describe('isTerminalState', () => {
  it('returns true for completed', () => {
    expect(isTerminalState('completed')).toBe(true);
  });

  it('returns true for cancelled', () => {
    expect(isTerminalState('cancelled')).toBe(true);
  });

  it('returns true for refunded', () => {
    expect(isTerminalState('refunded')).toBe(true);
  });

  it('returns false for active states', () => {
    expect(isTerminalState('inquiry')).toBe(false);
    expect(isTerminalState('tentative')).toBe(false);
    expect(isTerminalState('confirmed')).toBe(false);
    expect(isTerminalState('contracted')).toBe(false);
  });
});

describe('getNextStates', () => {
  it('returns tentative and cancelled for inquiry', () => {
    const next = getNextStates('inquiry');
    expect(next).toEqual(['tentative', 'cancelled']);
  });

  it('returns confirmed, cancelled, inquiry for tentative', () => {
    const next = getNextStates('tentative');
    expect(next).toContain('confirmed');
    expect(next).toContain('cancelled');
    expect(next).toContain('inquiry');
  });

  it('returns contracted, cancelled, tentative for confirmed', () => {
    const next = getNextStates('confirmed');
    expect(next).toContain('contracted');
    expect(next).toContain('cancelled');
    expect(next).toContain('tentative');
  });

  it('returns completed and cancelled for contracted', () => {
    const next = getNextStates('contracted');
    expect(next).toEqual(['completed', 'cancelled']);
  });

  it('returns empty for completed', () => {
    expect(getNextStates('completed')).toEqual([]);
  });

  it('returns refunded for cancelled', () => {
    expect(getNextStates('cancelled')).toEqual(['refunded']);
  });

  it('returns empty for refunded', () => {
    expect(getNextStates('refunded')).toEqual([]);
  });
});

describe('BookingStateError', () => {
  it('is an instance of Error', () => {
    const err = new BookingStateError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BookingStateError');
    expect(err.message).toBe('msg');
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.status).toBe(400);
    expect(err.details).toEqual({});
  });

  it('accepts custom code and status', () => {
    const err = new BookingStateError('custom', 'CUSTOM_CODE', 418, { x: 1 });
    expect(err.code).toBe('CUSTOM_CODE');
    expect(err.status).toBe(418);
    expect(err.details).toEqual({ x: 1 });
  });
});
