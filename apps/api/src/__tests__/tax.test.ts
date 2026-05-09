import { describe, it, expect } from 'vitest';
import { taxService } from '../services/tax.service.js';

describe('taxService', () => {
  it('returns zero tax for XX (no-tax)', () => {
    const result = taxService.calculate(10000, 'XX');
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(10000);
  });

  it('calculates US-NY sales tax (8.875%)', () => {
    const result = taxService.calculate(10000, 'US-NY');
    expect(result.taxRateBps).toBe(8875);
    expect(result.taxCents).toBe(888); // 10000 * 8875 / 100000 = 887.5 → 888
    expect(result.totalCents).toBe(10888);
  });

  it('calculates DE VAT (19%)', () => {
    const result = taxService.calculate(10000, 'DE');
    expect(result.taxRateBps).toBe(1900);
    expect(result.taxCents).toBe(190); // 10000 * 1900 / 100000 = 190
    expect(result.totalCents).toBe(10190);
  });

  it('lists all jurisdictions', () => {
    const jurisdictions = taxService.listJurisdictions();
    expect(jurisdictions.length).toBeGreaterThan(50);
    expect(jurisdictions.some(j => j.code === 'US-NY')).toBe(true);
    expect(jurisdictions.some(j => j.code === 'DE')).toBe(true);
    expect(jurisdictions.some(j => j.code === 'XX')).toBe(true);
  });

  it('resolves region codes', () => {
    expect(taxService.resolveRate('US-NY').rateBps).toBe(8875);
    expect(taxService.resolveRate('NY').rateBps).toBe(8875);
    expect(taxService.resolveRate('XX')).toBeTruthy();
    expect(taxService.resolveRate().code).toBe('XX');
  });

  it('handles zero amount', () => {
    const result = taxService.calculate(0, 'US-CA');
    expect(result.taxCents).toBe(0);
    expect(result.totalCents).toBe(0);
  });
});
