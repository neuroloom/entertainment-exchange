// NanoClaw DNA utilities — 128-char ATGC strand generation + mutation
// Ported from neuroloom-nano/evolution/genome.py
import { createHash } from 'node:crypto';
import type { DNAStrand } from './types.js';

const NUCLEOTIDES = ['A', 'T', 'G', 'C'] as const;
const DNA_LENGTH = 128;

/** Generate a DNA strand from any object via SHA-512 hashing */
export function dnaFromConfig(config: Record<string, unknown>): DNAStrand {
  const seed = JSON.stringify(config, Object.keys(config).sort());
  const hash = createHash('sha512').update(seed).digest('hex');
  let sequence = '';
  for (let i = 0; i < DNA_LENGTH; i++) {
    const idx = parseInt(hash[i], 16) % 4;
    sequence += NUCLEOTIDES[idx];
  }
  const lineageHash = createHash('sha256').update(sequence).digest('hex').slice(0, 12);
  return { sequence, lineage: [lineageHash] };
}

/** Create a child DNA from a mutated sequence and parent */
export function dnaFromMutated(mutatedSequence: string, parent: DNAStrand): DNAStrand {
  const sequence = (mutatedSequence + 'A'.repeat(DNA_LENGTH)).slice(0, DNA_LENGTH);
  const seqHash = createHash('sha256').update(sequence).digest('hex').slice(0, 12);
  return {
    sequence,
    lineage: [...parent.lineage, seqHash],
  };
}

/** Convert DNA to a 4-element frequency vector [A, T, G, C] */
export function dnaToVector(strand: DNAStrand): [number, number, number, number] {
  const a = strand.sequence.split('A').length - 1;
  const t = strand.sequence.split('T').length - 1;
  const g = strand.sequence.split('G').length - 1;
  const c = strand.sequence.split('C').length - 1;
  return [a / DNA_LENGTH, t / DNA_LENGTH, g / DNA_LENGTH, c / DNA_LENGTH];
}

/** DNA hash (first 12 chars of SHA-256) */
export function dnaHash(sequence: string): string {
  return createHash('sha256').update(sequence).digest('hex').slice(0, 12);
}

/** Validate DNA strand */
export function validateDNA(sequence: string): boolean {
  return sequence.length === DNA_LENGTH && [...sequence].every(c => NUCLEOTIDES.includes(c as typeof NUCLEOTIDES[number]));
}
