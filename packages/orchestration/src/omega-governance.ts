// SNP Governance + FED_SYNC Pattern Hydration + VGDO Scoring
// OMEGA_FLOOR (0.999999) governs all pattern acceptance

import {
  OMEGA_FLOOR, OMEGA_RED_LOOM, OMEGA_SNP, OMEGA_SEVERANCE,
  GDO_WEIGHT_OMEGA, GDO_WEIGHT_DNA, GDO_WEIGHT_S_ISO, GDO_WEIGHT_DELTA_C,
} from './types.js';
import type { FedSyncPattern, FedSyncBroadcast, VGDOScore } from './types.js';

export class SNPGovernance {
  private currentOmega = 1.0;
  private redLoomLog: FedSyncPattern[] = [];

  validatePattern(pattern: FedSyncPattern): boolean {
    if (pattern.omegaScore < OMEGA_FLOOR) {
      this.redLoomLog.push(pattern);
      return false;
    }
    return true;
  }

  setOmega(score: number): void { this.currentOmega = score; }
  get omega(): number { return this.currentOmega; }
  getDiagnostics(): FedSyncPattern[] { return [...this.redLoomLog]; }
}

export class FedSyncReceiver {
  private handlers: Array<(pattern: FedSyncPattern) => void> = [];
  private received: FedSyncBroadcast[] = [];
  private omegaScore = 1.0;

  onPattern(handler: (pattern: FedSyncPattern) => void): void {
    this.handlers.push(handler);
  }

  receive(broadcast: FedSyncBroadcast): void {
    this.received.push(broadcast);
    for (const pattern of broadcast.patterns) {
      if (pattern.omegaScore >= OMEGA_FLOOR) {
        this.handlers.forEach(h => h(pattern));
      }
    }
  }

  setOmega(score: number): void { this.omegaScore = score; }
  get omega(): number { return this.omegaScore; }
  get acceptedPatternCount(): number {
    return this.received
      .flatMap(b => b.patterns)
      .filter(p => p.omegaScore >= OMEGA_FLOOR).length;
  }
}

export function computeVGDO(omega: number, dnaFitness: number, sIso: number, deltaC: number): VGDOScore {
  const vgdo = GDO_WEIGHT_OMEGA * omega + GDO_WEIGHT_DNA * dnaFitness + GDO_WEIGHT_S_ISO * sIso + GDO_WEIGHT_DELTA_C * deltaC;
  let grade: VGDOScore['grade'];
  if (vgdo >= 0.95) grade = 'S';
  else if (vgdo >= 0.85) grade = 'A';
  else if (vgdo >= 0.75) grade = 'B';
  else if (vgdo >= 0.60) grade = 'C';
  else if (vgdo >= 0.40) grade = 'D';
  else grade = 'F';
  return { omega, dnaFitness, sIso, deltaC, vgdo, grade };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
