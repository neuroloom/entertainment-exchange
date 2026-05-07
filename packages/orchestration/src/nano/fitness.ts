// NanoClaw Fitness Engine — VGDO scoring, cosine similarity, grading
// Ported from neuroloom-nano/evolution/fitness.py

import type { EvolvableParams, FitnessGrade, VGDOResult } from './types.js';
import { GDO_WEIGHTS, GRADE_THRESHOLDS } from './types.js';

/** Compute VGDO meta-fitness from 4 weighted signals */
export function computeVGDO(omega: number, dnaFitness: number, sIso: number, deltaC: number): number {
  return (
    GDO_WEIGHTS.omega * omega +
    GDO_WEIGHTS.dna * dnaFitness +
    GDO_WEIGHTS.sIso * sIso +
    GDO_WEIGHTS.deltaC * deltaC
  );
}

/** Compute VGDO with grade */
export function scoreVGDO(omega: number, dnaFitness: number, sIso: number, deltaC: number): VGDOResult {
  const vgdo = computeVGDO(omega, dnaFitness, sIso, deltaC);
  let grade: FitnessGrade = 'F';
  for (const { grade: g, min } of GRADE_THRESHOLDS) {
    if (vgdo >= min) { grade = g; break; }
  }
  return { omega, dnaFitness, sIso, deltaC, vgdo, grade };
}

/** Cosine similarity between two vectors */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/** Map VGDO to letter grade */
export function fitnessGrade(vgdo: number): FitnessGrade {
  for (const { grade, min } of GRADE_THRESHOLDS) {
    if (vgdo >= min) return grade;
  }
  return 'F';
}

// --- Synthetic task evaluation (matching Python epoch_runner.py) ---

interface SyntheticTask {
  type: string;
  complexity: number;
  expectedTools: number;
}

const SYNTHETIC_TASKS: SyntheticTask[] = [
  { type: 'file_read', complexity: 0.2, expectedTools: 1 },
  { type: 'code_gen', complexity: 0.7, expectedTools: 3 },
  { type: 'bash_command', complexity: 0.3, expectedTools: 1 },
  { type: 'code_review', complexity: 0.8, expectedTools: 4 },
  { type: 'research', complexity: 0.5, expectedTools: 2 },
  { type: 'refactor', complexity: 0.9, expectedTools: 5 },
  { type: 'debug', complexity: 0.6, expectedTools: 3 },
  { type: 'explain', complexity: 0.3, expectedTools: 0 },
];

/** Evaluate a parameter set on synthetic tasks. Returns fitness score [0, 1]. */
export function evaluateParams(params: EvolvableParams, tasks?: SyntheticTask[]): number {
  const tasks_ = tasks ?? SYNTHETIC_TASKS;
  let totalScore = 0;

  for (const task of tasks_) {
    let score = 0;
    const complexity = task.complexity;

    // Temperature fitness: prefer lower temp for simple tasks, moderate for complex
    const idealTemp = 0.3 + complexity * 0.8;
    const tempScore = 1.0 - Math.min(1.0, Math.abs(params.temperature - idealTemp) / 1.0);
    score += tempScore * 0.25;

    // Tool threshold: lower threshold = more tool usage, good for tool-heavy tasks
    if (task.expectedTools > 0) {
      const idealThreshold = Math.max(0.2, 1.0 - task.expectedTools * 0.15);
      const threshScore = 1.0 - Math.min(1.0, Math.abs(params.toolThreshold - idealThreshold) / 0.5);
      score += threshScore * 0.25;
    } else {
      score += 0.25;
    }

    // Cache aggressiveness: higher = better
    score += params.cacheAggressiveness * 0.25;

    // Context reserve: enough room for tool results
    const reserveScore = 1.0 - Math.abs(params.contextReserve - 0.3) / 0.3;
    score += Math.max(0, reserveScore) * 0.25;

    totalScore += score;
  }

  return tasks_.length > 0 ? totalScore / tasks_.length : 0;
}
