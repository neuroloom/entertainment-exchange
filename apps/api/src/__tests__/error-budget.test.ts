import { describe, it, expect } from 'vitest';
import { errorBudget } from '../services/error-budget.service.js';

describe('errorBudget', () => {
  it('starts with healthy budget for zero traffic', () => {
    const budget = errorBudget.getBudget('new-tenant');
    expect(budget.tenantId).toBe('new-tenant');
    expect(budget.totalRequests).toBe(0);
    expect(budget.errorCount).toBe(0);
    expect(budget.budgetRemaining).toBeGreaterThanOrEqual(0);
    expect(budget.status).toBe('healthy');
  });

  it('records requests and tracks error count', () => {
    errorBudget.recordRequest('tenant-errors', false);
    errorBudget.recordRequest('tenant-errors', false);
    errorBudget.recordRequest('tenant-errors', true);

    const budget = errorBudget.getBudget('tenant-errors');
    expect(budget.totalRequests).toBe(3);
    expect(budget.errorCount).toBe(1);
  });

  it('reports budget usage after errors', () => {
    // Record 1000 requests with 2 errors (0.2% error rate against 0.1% budget for 99.9 SLO)
    for (let i = 0; i < 1000; i++) {
      errorBudget.recordRequest('budget-tenant', i < 2);
    }

    const budget = errorBudget.getBudget('budget-tenant', 99.9);
    expect(budget.totalRequests).toBe(1000);
    expect(budget.errorCount).toBe(2);
    expect(budget.budgetUsedPct).toBeGreaterThan(0);
    expect(budget.burnRate).toBeGreaterThan(0);
  });

  it('reports exhausted status when budget is depleted', () => {
    // 1 request, 1 error — consumes entire budget immediately
    errorBudget.recordRequest('exhausted-tenant', true);

    const budget = errorBudget.getBudget('exhausted-tenant', 99.9);
    // budgetTotal = max(1 * 0.001, 1) = 1, errorCount = 1, budgetRemaining = 0
    expect(budget.status).toBe('exhausted');
  });

  it('returns history for multiple months', () => {
    const history = errorBudget.getHistory('history-tenant', 3);
    expect(history).toHaveLength(3);
    expect(history[0].tenantId).toBe('history-tenant');
    // Periods should be in chronological order
    expect(history[0].period <= history[1].period).toBe(true);
    expect(history[1].period <= history[2].period).toBe(true);
  });

  it('is tenant-isolated', () => {
    errorBudget.recordRequest('tenant-a', true);
    errorBudget.recordRequest('tenant-b', false);

    const budgetA = errorBudget.getBudget('tenant-a');
    const budgetB = errorBudget.getBudget('tenant-b');

    expect(budgetA.totalRequests).toBe(1);
    expect(budgetA.errorCount).toBe(1);
    expect(budgetB.totalRequests).toBe(1);
    expect(budgetB.errorCount).toBe(0);
  });
});
