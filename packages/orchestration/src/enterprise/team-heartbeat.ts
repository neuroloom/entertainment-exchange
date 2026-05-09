// Team Heartbeat Monitor
// Health monitoring with pulse/ping/rebalance lifecycle
// Derived from neuroloomorg/neuroloom-enterprise-orchestrator
// Wired to MetricsCollector from warp-cache

import { EventEmitter } from 'events';
import { DEFAULT_HEARTBEAT_CONFIG } from './types.js';
import type {
  HeartbeatConfig,
  HeartbeatSignal,
  CompanyHealth,
} from './types.js';

export class HeartbeatEmitter extends EventEmitter {
  private intervalMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private signalCallback: () => HeartbeatSignal;

  constructor(
    signalCallback: () => HeartbeatSignal,
    intervalMs: number = DEFAULT_HEARTBEAT_CONFIG.intervalMs,
  ) {
    super();
    this.intervalMs = intervalMs;
    this.signalCallback = signalCallback;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const signal = this.signalCallback();
      this.emit('heartbeat', signal);
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  pulse(): HeartbeatSignal {
    const signal = this.signalCallback();
    this.emit('heartbeat', signal);
    return signal;
  }

  get isRunning(): boolean {
    return this.timer !== undefined;
  }
}

export class HealthAggregator {
  private latestSignals = new Map<string, HeartbeatSignal>();

  ingest(signal: HeartbeatSignal): void {
    this.latestSignals.set(signal.agentId, signal);
  }

  compute(): CompanyHealth {
    const signals = Array.from(this.latestSignals.values());
    const agentCount = signals.length;
    const healthyCount = signals.filter(s => s.status === 'healthy').length;
    const degradedCount = signals.filter(s => s.status === 'degraded').length;
    const criticalCount = signals.filter(s => s.status === 'critical').length;
    const offlineCount = signals.filter(s => s.status === 'offline').length;

    const rawScore = agentCount === 0
      ? 100
      : (healthyCount * 1.0 + degradedCount * 0.5 + criticalCount * 0.25 + offlineCount * 0) / agentCount * 100;

    const score = Math.round(rawScore);

    const summary = agentCount === 0
      ? 'No agents registered'
      : `${healthyCount}/${agentCount} healthy, ${degradedCount} degraded, ${criticalCount} critical, ${offlineCount} offline`;

    return {
      score,
      timestamp: new Date().toISOString(),
      agentCount,
      healthyCount,
      degradedCount,
      criticalCount,
      offlineCount,
      signals,
      summary,
    };
  }

  getSignal(agentId: string): HeartbeatSignal | undefined {
    return this.latestSignals.get(agentId);
  }

  clear(): void {
    this.latestSignals.clear();
  }

  get agentCount(): number {
    return this.latestSignals.size;
  }
}

export class TeamHeartbeatMonitor {
  private config: HeartbeatConfig;
  private emitterRegistry = new Map<string, HeartbeatEmitter>();
  readonly aggregator = new HealthAggregator();

  // Metrics callback — wired to OutputMaximizer's MetricsCollector
  private metricsCallback?: (signal: HeartbeatSignal) => void;

  constructor(
    config: Partial<HeartbeatConfig> = {},
    metricsCallback?: (signal: HeartbeatSignal) => void,
  ) {
    this.config = { ...DEFAULT_HEARTBEAT_CONFIG, ...config };
    this.metricsCallback = metricsCallback;
  }

  /** Register an agent for heartbeat tracking */
  registerAgent(
    agentId: string,
    teamId: string,
    signalFn: () => Omit<HeartbeatSignal, 'agentId' | 'teamId'>,
  ): HeartbeatEmitter {
    const emitter = new HeartbeatEmitter(() => {
      const partial = signalFn();
      const signal: HeartbeatSignal = { agentId, teamId, ...partial };
      this.aggregator.ingest(signal);
      this.metricsCallback?.(signal);
      return signal;
    }, this.config.intervalMs);
    this.emitterRegistry.set(agentId, emitter);
    return emitter;
  }

  /** Remove an agent from heartbeat tracking */
  unregisterAgent(agentId: string): void {
    const emitter = this.emitterRegistry.get(agentId);
    if (emitter) {
      emitter.stop();
      emitter.removeAllListeners();
      this.emitterRegistry.delete(agentId);
    }
  }

  /** Start all heartbeat emitters */
  startAll(): void {
    for (const emitter of this.emitterRegistry.values()) {
      emitter.start();
    }
  }

  /** Stop all heartbeat emitters */
  stopAll(): void {
    for (const emitter of this.emitterRegistry.values()) {
      emitter.stop();
    }
  }

  /** Single pulse across all agents */
  pulseAll(): HeartbeatSignal[] {
    const signals: HeartbeatSignal[] = [];
    for (const emitter of this.emitterRegistry.values()) {
      signals.push(emitter.pulse());
    }
    return signals;
  }

  /** Compute overall company health */
  getHealth(): CompanyHealth {
    return this.aggregator.compute();
  }

  /** Status summary string for dashboard */
  getStatusString(): string {
    const health = this.getHealth();
    const { score, summary } = health;
    const grade = score >= 90 ? 'EXCELLENT' : score >= 70 ? 'GOOD' : score >= 50 ? 'DEGRADED' : 'CRITICAL';
    return `[${grade}] Score ${score}/100 — ${summary}`;
  }

  get agentCount(): number {
    return this.emitterRegistry.size;
  }
}
