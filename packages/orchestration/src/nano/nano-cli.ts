#!/usr/bin/env tsx
// NanoClaw CLI — DNA evolution, checkpoint management, and lineage tracking
// Ported from neuroloom-nano/nano_claw.py (1481 lines) — 55+ slash commands
// Invoke: npx tsx src/nano/nano-cli.ts <subcommand> [options]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NanoAgent } from './nano-agent.js';
import type { EpochCallback } from './nano-agent.js';
import { NanoMutationEngine } from './mutation.js';
import { dnaFromConfig, dnaToVector, dnaFromMutated, dnaHash } from './dna.js';
import { scoreVGDO, evaluateParams, cosineSimilarity } from './fitness.js';
import {
  loadLatestCheckpoint, listCheckpoints, listSessions, resumeLatestSession, checkpointCount,
} from './checkpoint.js';
import type { EvolvableParams, EvolutionResult } from './types.js';
import {
  DEFAULT_EVOLVABLE_PARAMS, DEFAULT_EVOLUTION_OPTIONS,
  OMEGA_FLOOR, GRADE_THRESHOLDS,
} from './types.js';

// For the CLI, we create a minimal OutputMaximizer stand-in.
// The real one requires a model function set via setModelFn().
// In CLI mode, infers go through the mock path (processBatch returns [mock]...).
import { OutputMaximizer } from '../output-maximizer.js';

// ---------------------------------------------------------------------------
// CLI Helpers
// ---------------------------------------------------------------------------

const USAGE = `
NanoClaw CLI — DNA Evolution Engine & Lineage Tracker
=====================================================
Commands:
  evolve [epochs]             Run evolution loop (default: 1000 epochs)
  lineage <dna-file>          Trace lineage of a saved DNA strand
  mutate <config-file>        Mutate an agent config and print resulting DNA
  benchmark <dna-file>        Evaluate DNA fitness on synthetic benchmark
  checkpoint list [session]   List checkpoints (all sessions or specific)
  checkpoint resume           Resume from latest checkpoint
  checkpoint show <session>   Show last checkpoint for a session
  sessions                    List all sessions with checkpoint history
  vectors <config-file>       Print DNA frequency vectors
  diff <file-a> <file-b>      Cosine similarity between two DNAs
  help                        Show this help

Options:
  --epochs N                  Number of evolution epochs (default 1000)
  --dry-run                   Skip file writes during evolution
  --callback                  Print progress each epoch
  --output <path>             Write results to file (JSON)
`.slice(1);

function bail(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function readJsonFile(path: string): Record<string, unknown> {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) bail(`File not found: ${fullPath}`);
  try {
    return JSON.parse(readFileSync(fullPath, 'utf-8'));
  } catch {
    bail(`Invalid JSON: ${fullPath}`);
  }
}

function writeJsonFile(path: string, data: unknown): void {
  writeFileSync(resolve(path), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatEvolveResult(result: EvolutionResult): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('╔════════════════════════════════════════════════════════╗');
  lines.push('║        NanoClaw Evolution — Complete                  ║');
  lines.push('╠════════════════════════════════════════════════════════╣');
  lines.push(`║  Epochs run:     ${String(result.historyLength).padStart(35)}  ║`);
  lines.push(`║  Elapsed:        ${String(result.elapsedSeconds + 's').padStart(35)}  ║`);
  lines.push(`║  Avg VGDO:       ${String(result.avgVgdo.toFixed(4)).padStart(35)}  ║`);
  lines.push(`║  Best VGDO:      ${String(result.bestVgdo.toFixed(4)).padStart(35)}  ║`);
  lines.push(`║  Final VGDO:     ${String(result.finalVgdo.toFixed(4)).padStart(35)}  ║`);
  lines.push(`║  Final Grade:    ${String(result.finalGrade).padStart(35)}  ║`);
  lines.push(`║  Improvements:   ${String(result.improvements).padStart(35)}  ║`);
  lines.push(`║  Regressions:    ${String(result.regressions).padStart(35)}  ║`);
  lines.push(`║  Rate:           ${String(result.improvementRate).padStart(35)}  ║`);
  if (result.haltedEarly) {
    lines.push(`║  Halted early:   ${String(`at epoch ${result.haltEpoch}`).padStart(35)}  ║`);
  }
  lines.push(`║  Rollbacks:      ${String(result.rollbackCount).padStart(35)}  ║`);
  lines.push('╠════════════════════════════════════════════════════════╣');
  lines.push('║  Best Params                                         ║');
  lines.push(`║    temperature:        ${String(result.bestParams.temperature.toFixed(4)).padStart(25)}  ║`);
  lines.push(`║    toolThreshold:      ${String(result.bestParams.toolThreshold.toFixed(4)).padStart(25)}  ║`);
  lines.push(`║    cacheAggressiveness:${String(result.bestParams.cacheAggressiveness.toFixed(4)).padStart(25)}  ║`);
  lines.push(`║    compactThreshold:   ${String(result.bestParams.compactThreshold.toFixed(4)).padStart(25)}  ║`);
  lines.push(`║    maxToolLoops:       ${String(result.bestParams.maxToolLoops).padStart(25)}  ║`);
  lines.push(`║    contextReserve:     ${String(result.bestParams.contextReserve.toFixed(4)).padStart(25)}  ║`);
  lines.push('╚════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(NanoAgent.formatProgress(result.history));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** evolve [epochs] */
async function cmdEvolve(args: string[]): Promise<void> {
  const epochs = parseInt(args[0] ?? '', 10) || DEFAULT_EVOLUTION_OPTIONS.epochs;
  const dryRun = args.includes('--dry-run');

  console.log(`\nStarting evolution: ${epochs} epochs${dryRun ? ' (dry-run)' : ''}`);
  console.log(`OMEGA_FLOOR: ${OMEGA_FLOOR}`);
  console.log('');

  const maximizer = new OutputMaximizer();
  const agent = new NanoAgent(maximizer);

  let lastPrintEpoch = 0;
  const progressCb: EpochCallback = (epoch, vgdo, grade, improved) => {
    if (epoch % 100 === 0 || epoch === epochs || epoch - lastPrintEpoch >= 100) {
      const mark = improved ? '+' : '-';
      console.log(`  [${String(epoch).padStart(4)}] VGDO=${vgdo.toFixed(4)} ${grade} ${mark}`);
      lastPrintEpoch = epoch;
    }
  };

  const result = await agent.run(
    { epochs, dryRun },
    args.includes('--callback') ? progressCb : undefined,
  );

  console.log(formatEvolveResult(result));

  // Write output if requested
  const outputIdx = args.indexOf('--output');
  if (outputIdx >= 0 && args[outputIdx + 1]) {
    const outPath = args[outputIdx + 1];
    writeJsonFile(outPath, { ...result, history: undefined });
    writeJsonFile(outPath.replace('.json', '.history.json'), result.history);
    console.log(`\nResults written to: ${outPath}`);
    console.log(`History written to:  ${outPath.replace('.json', '.history.json')}`);
  }
}

/** lineage <dna-file> */
function cmdLineage(args: string[]): void {
  const path = args[0];
  if (!path) bail('lineage requires <dna-file> argument');
  const data = readJsonFile(path);
  if (!data.lineage || !Array.isArray(data.lineage)) {
    bail('Not a valid DNA file (missing lineage array)');
  }
  const lineage = data.lineage as string[];
  console.log(`\nDNA Lineage (${lineage.length} generations):`);
  lineage.forEach((hash, i) => {
    console.log(`  ${String(i).padStart(3)}. ${hash}`);
  });
}

/** mutate <config-file> */
function cmdMutate(args: string[]): void {
  const path = args[0];
  if (!path) bail('mutate requires <config-file> argument');
  const config = readJsonFile(path);
  const dna = dnaFromConfig(config);
  const engine = new NanoMutationEngine(4);
  const mutated = engine.mutate([{ id: 'cli_mutate', sourcePods: [0, 1] }]);
  const child = dnaFromMutated(mutated[0]?.mutatedSequence ?? dna.sequence, dna);

  console.log('\nOriginal DNA:');
  console.log(`  sequence: ${dna.sequence}`);
  console.log(`  hash:     ${dnaHash(dna.sequence)}`);

  if (mutated.length > 0) {
    const m = mutated[0];
    console.log('\nMutated DNA (6 protocols applied):');
    console.log(`  dnaId:         ${m.dnaId}`);
    console.log(`  sequence:      ${m.mutatedSequence}`);
    console.log(`  gravityScore:  ${m.gravityScore.toFixed(4)}`);
    console.log(`  omega:         ${m.safetyMetrics.omega}`);
    console.log(`  gatesPassed:   ${m.safetyMetrics.gatesPassed}`);
    console.log(`  cluster:       ${m.clusterId}`);
  }

  console.log('\nChild DNA:');
  console.log(`  sequence: ${child.sequence}`);
  console.log(`  lineage:  ${child.lineage.join(' -> ')}`);
  console.log(`  vector:   [${dnaToVector(child).map(v => v.toFixed(3)).join(', ')}]`);
}

/** benchmark <dna-file> */
function cmdBenchmark(args: string[]): void {
  const path = args[0];
  if (!path) bail('benchmark requires <dna-file> argument');
  const config = readJsonFile(path);

  // Extract params from file or use defaults
  const params: EvolvableParams = {
    temperature: (config.temperature as number) ?? DEFAULT_EVOLVABLE_PARAMS.temperature,
    promptWeight: (config.promptWeight as number) ?? DEFAULT_EVOLVABLE_PARAMS.promptWeight,
    toolThreshold: (config.toolThreshold as number) ?? DEFAULT_EVOLVABLE_PARAMS.toolThreshold,
    cacheAggressiveness: (config.cacheAggressiveness as number) ?? DEFAULT_EVOLVABLE_PARAMS.cacheAggressiveness,
    compactThreshold: (config.compactThreshold as number) ?? DEFAULT_EVOLVABLE_PARAMS.compactThreshold,
    maxToolLoops: (config.maxToolLoops as number) ?? DEFAULT_EVOLVABLE_PARAMS.maxToolLoops,
    contextReserve: (config.contextReserve as number) ?? DEFAULT_EVOLVABLE_PARAMS.contextReserve,
    costWeight: (config.costWeight as number) ?? DEFAULT_EVOLVABLE_PARAMS.costWeight,
    speedWeight: (config.speedWeight as number) ?? DEFAULT_EVOLVABLE_PARAMS.speedWeight,
    qualityWeight: (config.qualityWeight as number) ?? DEFAULT_EVOLVABLE_PARAMS.qualityWeight,
  };

  const fitness = evaluateParams(params);
  const dna = dnaFromConfig(config as unknown as Record<string, unknown>);
  const [a, t, g, c] = dnaToVector(dna);
  const vgdo = scoreVGDO(OMEGA_FLOOR, fitness, 0.85, 0.9);

  console.log('\nBenchmark Results:');
  console.log('─────────────────────────────────────────────');
  console.log(`  Fitness score:     ${fitness.toFixed(6)}`);
  console.log(`  VGDO:              ${vgdo.vgdo.toFixed(6)}`);
  console.log(`  Grade:             ${vgdo.grade}`);
  console.log(`  Omega (Ω):         ${vgdo.omega}`);
  console.log(`  DNA vector:        [A=${a.toFixed(3)} T=${t.toFixed(3)} G=${g.toFixed(3)} C=${c.toFixed(3)}]`);
  console.log(`  Temperature:       ${params.temperature.toFixed(3)}`);
  console.log(`  Tool threshold:    ${params.toolThreshold.toFixed(3)}`);
  console.log(`  Cache aggressive:  ${params.cacheAggressiveness.toFixed(3)}`);

  // Grade comparison
  console.log('\nGrade thresholds:');
  for (const { grade, min } of GRADE_THRESHOLDS) {
    const met = vgdo.vgdo >= min ? '✓' : ' ';
    console.log(`  ${met} ${grade}: ≥ ${min}`);
  }
}

/** checkpoint list [session] */
function cmdCheckpointList(args: string[]): void {
  const sessionId = args[0];
  if (sessionId) {
    const cps = listCheckpoints(sessionId, 50);
    if (cps.length === 0) {
      console.log(`No checkpoints for session: ${sessionId}`);
      return;
    }
    console.log(`\nCheckpoints for ${sessionId}:`);
    console.log('  ┌──────┬─────────────────────┬─────────────────────────┬──────────┐');
    console.log('  │ Step │ Timestamp           │ Function                │ Size     │');
    console.log('  ├──────┼─────────────────────┼─────────────────────────┼──────────┤');
    for (const cp of cps) {
      const ts = new Date(cp.timestamp * 1000).toISOString().replace('T', ' ').slice(0, 19);
      console.log(`  │ ${String(cp.step).padStart(4)} │ ${ts} │ ${cp.functionName.padEnd(23).slice(0, 23)} │ ${String(cp.messagesSize).padStart(7)} │`);
    }
    console.log('  └──────┴─────────────────────┴─────────────────────────┴──────────┘');
  } else {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log('No sessions with checkpoints.');
      return;
    }
    console.log('\nAll sessions:');
    console.log('  ┌────────────────────────────────────────┬───────┬─────────────────────┐');
    console.log('  │ Session ID                             │ Steps │ Last Checkpoint     │');
    console.log('  ├────────────────────────────────────────┼───────┼─────────────────────┤');
    for (const s of sessions) {
      const ts = new Date(s.lastTimestamp * 1000).toISOString().replace('T', ' ').slice(0, 19);
      console.log(`  │ ${s.sessionId.padEnd(38).slice(0, 38)} │ ${String(s.steps).padStart(5)} │ ${ts} │`);
    }
    console.log('  └────────────────────────────────────────┴───────┴─────────────────────┘');
  }
}

/** checkpoint resume */
function cmdCheckpointResume(): void {
  const cp = resumeLatestSession();
  if (!cp) {
    console.log('No checkpoint to resume from.');
    return;
  }
  console.log('\nResumed session:');
  console.log(`  sessionId:    ${cp.sessionId}`);
  console.log(`  step:         ${cp.step}`);
  console.log(`  function:     ${cp.functionName}`);
  console.log(`  timestamp:    ${new Date(cp.timestamp * 1000).toISOString()}`);
  console.log(`  result type:  ${typeof cp.result}`);
  console.log(`  state keys:   ${cp.state ? Object.keys(cp.state).join(', ') : '(none)'}`);
}

/** checkpoint show <session> */
function cmdCheckpointShow(args: string[]): void {
  const sessionId = args[0];
  if (!sessionId) bail('checkpoint show requires <session> argument');
  const cp = loadLatestCheckpoint(sessionId);
  if (!cp) {
    console.log(`No checkpoint found for session: ${sessionId}`);
    return;
  }
  console.log('\nLatest checkpoint:');
  console.log(`  sessionId:    ${cp.sessionId}`);
  console.log(`  step:         ${cp.step}`);
  console.log(`  function:     ${cp.functionName}`);
  console.log(`  timestamp:    ${new Date(cp.timestamp * 1000).toISOString()}`);
  console.log(`  messages:     ${JSON.stringify(cp.messages).length} chars`);
  console.log(`  result:       ${JSON.stringify(cp.result).slice(0, 200)}`);
}

/** sessions */
function cmdSessions(): void {
  const sessions = listSessions();
  console.log(`\nTotal checkpoints: ${checkpointCount()}`);
  console.log(`Active sessions:    ${sessions.length}\n`);
  cmdCheckpointList([]);
}

/** vectors <config-file> */
function cmdVectors(args: string[]): void {
  const path = args[0];
  if (!path) bail('vectors requires <config-file> argument');
  const config = readJsonFile(path);
  const dna = dnaFromConfig(config);
  const [a, t, g, c] = dnaToVector(dna);
  console.log('\nDNA Frequency Vector:');
  console.log(`  A: ${a.toFixed(4)}  (${(a * 128).toFixed(0)} nucleotides)`);
  console.log(`  T: ${t.toFixed(4)}  (${(t * 128).toFixed(0)} nucleotides)`);
  console.log(`  G: ${g.toFixed(4)}  (${(g * 128).toFixed(0)} nucleotides)`);
  console.log(`  C: ${c.toFixed(4)}  (${(c * 128).toFixed(0)} nucleotides)`);
  console.log(`  hash: ${dnaHash(dna.sequence)}`);
}

/** diff <file-a> <file-b> */
function cmdDiff(args: string[]): void {
  const [pathA, pathB] = args;
  if (!pathA || !pathB) bail('diff requires <file-a> <file-b> arguments');
  const configA = readJsonFile(pathA);
  const configB = readJsonFile(pathB);
  const dnaA = dnaFromConfig(configA);
  const dnaB = dnaFromConfig(configB);
  const similar = cosineSimilarity(dnaToVector(dnaA) as unknown as number[], dnaToVector(dnaB) as unknown as number[]);

  console.log('\nDNA Diff:');
  console.log(`  File A:     ${resolve(pathA)}`);
  console.log(`  File B:     ${resolve(pathB)}`);
  console.log(`  Similarity: ${(similar * 100).toFixed(2)}%`);
  console.log(`  A hash:     ${dnaHash(dnaA.sequence)}`);
  console.log(`  B hash:     ${dnaHash(dnaB.sequence)}`);
  console.log(`  A vector:   [${dnaToVector(dnaA).map(v => v.toFixed(3)).join(', ')}]`);
  console.log(`  B vector:   [${dnaToVector(dnaB).map(v => v.toFixed(3)).join(', ')}]`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const subcommand = process.argv[2]?.toLowerCase() ?? 'help';
const subArgs = process.argv.slice(3);

async function main(): Promise<void> {
  switch (subcommand) {
    case 'evolve':
      return cmdEvolve(subArgs);
    case 'lineage':
      return cmdLineage(subArgs);
    case 'mutate':
      return cmdMutate(subArgs);
    case 'benchmark':
      return cmdBenchmark(subArgs);
    case 'checkpoint':
      {
        const sub = subArgs[0]?.toLowerCase();
        const rest = subArgs.slice(1);
        switch (sub) {
          case 'list': return cmdCheckpointList(rest);
          case 'resume': return cmdCheckpointResume();
          case 'show': return cmdCheckpointShow(rest);
          default:
            console.log('checkpoint subcommands: list [session], resume, show <session>');
            return;
        }
      }
    case 'sessions':
      return cmdSessions();
    case 'vectors':
      return cmdVectors(subArgs);
    case 'diff':
      return cmdDiff(subArgs);
    case 'help':
    default:
      console.log(USAGE);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
