// A/B testing — compare agent configurations and strategies
import { v4 as uuid } from 'uuid';

export interface AbExperiment {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  variantA: string;   // Agent ID
  variantB: string;   // Agent ID
  metric: 'cost' | 'latency' | 'success_rate' | 'vgdo';
  status: 'draft' | 'running' | 'completed';
  startedAt?: string;
  completedAt?: string;
  winner?: 'A' | 'B' | 'tie';
  createdAt: string;
}

export interface AbTrial {
  experimentId: string;
  variant: 'A' | 'B';
  metricValue: number;
  timestamp: string;
}

const experiments: AbExperiment[] = [];
const trials: AbTrial[] = [];

export const abTesting = {
  createExperiment(tenantId: string, opts: { name: string; description: string; variantA: string; variantB: string; metric: AbExperiment['metric'] }): AbExperiment {
    const exp: AbExperiment = {
      id: uuid(), tenantId, ...opts,
      status: 'draft', createdAt: new Date().toISOString(),
    };
    experiments.push(exp);
    return exp;
  },

  list(tenantId: string): AbExperiment[] {
    return experiments.filter(e => e.tenantId === tenantId);
  },

  get(id: string, tenantId: string): AbExperiment | undefined {
    return experiments.find(e => e.id === id && e.tenantId === tenantId);
  },

  start(id: string, tenantId: string): AbExperiment | null {
    const e = experiments.find(ee => ee.id === id && ee.tenantId === tenantId && ee.status === 'draft');
    if (!e) return null;
    e.status = 'running';
    e.startedAt = new Date().toISOString();
    return e;
  },

  recordTrial(experimentId: string, variant: 'A' | 'B', metricValue: number): void {
    const e = experiments.find(ee => ee.id === experimentId);
    if (!e || e.status !== 'running') return;

    trials.push({ experimentId, variant, metricValue, timestamp: new Date().toISOString() });

    // Auto-complete after 50 trials
    const expTrials = trials.filter(t => t.experimentId === experimentId);
    if (expTrials.length >= 50) {
      this.complete(experimentId, e.tenantId);
    }
  },

  complete(id: string, tenantId: string): AbExperiment | null {
    const e = experiments.find(ee => ee.id === id && ee.tenantId === tenantId && ee.status === 'running');
    if (!e) return null;

    const expTrials = trials.filter(t => t.experimentId === id);
    const aTrials = expTrials.filter(t => t.variant === 'A');
    const bTrials = expTrials.filter(t => t.variant === 'B');

    if (aTrials.length < 5 || bTrials.length < 5) {
      e.winner = 'tie';
    } else {
      const aMean = aTrials.reduce((s, t) => s + t.metricValue, 0) / aTrials.length;
      const bMean = bTrials.reduce((s, t) => s + t.metricValue, 0) / bTrials.length;

      // Lower is better for cost/latency, higher for success_rate/vgdo
      const lowerBetter = e.metric === 'cost' || e.metric === 'latency';
      const improvement = lowerBetter
        ? (aMean - bMean) / aMean * 100
        : (bMean - aMean) / aMean * 100;

      e.winner = Math.abs(improvement) < 5 ? 'tie' : improvement > 0 ? 'B' : 'A';
    }

    e.status = 'completed';
    e.completedAt = new Date().toISOString();
    return e;
  },

  getResults(id: string, tenantId: string): { experiment: AbExperiment; aTrials: AbTrial[]; bTrials: AbTrial[]; aMean: number; bMean: number } | null {
    const e = experiments.find(ee => ee.id === id && ee.tenantId === tenantId);
    if (!e) return null;

    const aTrials = trials.filter(t => t.experimentId === id && t.variant === 'A');
    const bTrials = trials.filter(t => t.experimentId === id && t.variant === 'B');
    const aMean = aTrials.length > 0 ? aTrials.reduce((s, t) => s + t.metricValue, 0) / aTrials.length : 0;
    const bMean = bTrials.length > 0 ? bTrials.reduce((s, t) => s + t.metricValue, 0) / bTrials.length : 0;

    return { experiment: e, aTrials, bTrials, aMean, bMean };
  },
};
