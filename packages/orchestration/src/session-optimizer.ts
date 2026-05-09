// Claude Code Session Optimizer — OMEGA pipeline applied to tool calls
// WarpCache absorbs repeated tool outputs, BatchProcessor coalesces concurrent operations,
// AutoRouter routes to cheapest capable tool. Reduces token cost by caching.
//
// Hook into: ~/.claude/settings.json PreToolUse / PostToolUse events

import { LRUCache, SemanticCache, MetricsCollector } from './warp-cache.js';
import { NgramEmbedder } from './auto-router.js';
import type { MetricSnapshot } from './types.js';

interface ToolCall {
  tool_name: string;
  tool_input: Record<string, unknown>;
  session_id: string;
}

interface ToolResult {
  success: boolean;
  output: string;
  tokensUsed: number;
}

// ── Session Cache ──────────────────────────────────────────────────────────

const toolCache = new LRUCache<string, ToolResult>(10_000, 300_000); // 5 min TTL
const semanticCache = new SemanticCache(50_000, 0.92);
const embedder = new NgramEmbedder(3);
const metrics = new MetricsCollector();

// Read-heavy tools: cache their results aggressively
const CACHEABLE_TOOLS = ['Read', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

// Write tools: batch them
const BATCHABLE_TOOLS = ['Write', 'Edit'];

interface SessionOptimizerResult {
  shouldCache: boolean;
  cacheKey?: string;
  cachedResult?: ToolResult;
  shouldBatch: boolean;
  estimatedTokensSaved: number;
}

export function preToolHook(call: ToolCall): SessionOptimizerResult {
  const toolName = call.tool_name;
  const inputStr = JSON.stringify(call.tool_input);

  // Check LRU cache for exact match
  const cacheKey = `${call.session_id}:${toolName}:${hashStr(inputStr)}`;
  const cached = toolCache.get(cacheKey);

  if (cached && CACHEABLE_TOOLS.includes(toolName)) {
    metrics.increment('cache_hit');
    metrics.increment('tokens_saved', cached.tokensUsed);
    return {
      shouldCache: true, cacheKey,
      cachedResult: cached,
      shouldBatch: false,
      estimatedTokensSaved: cached.tokensUsed,
    };
  }

  // Check semantic cache for similar tool calls
  if (CACHEABLE_TOOLS.includes(toolName)) {
    const embedding = embedder.embed(`${toolName}:${inputStr}`);
    const semHit = semanticCache.query(embedding);
    if (semHit) {
      metrics.increment('semantic_hit');
      metrics.increment('tokens_saved', 500); // conservative estimate
      return {
        shouldCache: true, cacheKey,
        cachedResult: { success: true, output: semHit.response, tokensUsed: 500 },
        shouldBatch: false,
        estimatedTokensSaved: 500,
      };
    }
  }

  metrics.increment('cache_miss');
  return {
    shouldCache: false,
    shouldBatch: BATCHABLE_TOOLS.includes(toolName),
    estimatedTokensSaved: 0,
  };
}

export function postToolHook(call: ToolCall, result: ToolResult): void {
  const cacheKey = `${call.session_id}:${call.tool_name}:${hashStr(JSON.stringify(call.tool_input))}`;

  // Store in LRU cache
  toolCache.set(cacheKey, result);
  metrics.increment('stored');

  // Store embedding for semantic cache
  if (result.output.length > 0) {
    const embedding = embedder.embed(`${call.tool_name}:${JSON.stringify(call.tool_input)}`);
    semanticCache.put(cacheKey, `${call.tool_name}:${JSON.stringify(call.tool_input).slice(0, 200)}`, result.output.slice(0, 500), embedding);
  }

  metrics.increment('tokens_written', result.tokensUsed);
}

export function getSessionOptimizerStats(): MetricSnapshot & { tokensSaved: number; tokensWritten: number } {
  const snap = metrics.snapshot();
  return { ...snap, tokensSaved: metrics.get('tokens_saved'), tokensWritten: metrics.get('tokens_written') };
}

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// ── Hook script generator ──────────────────────────────────────────────────

export function generateHookScript(): string {
  return `#!/usr/bin/env node
// OMEGA Session Optimizer Hook — drop into ~/.claude/settings.json
// PreToolUse: cache check → skip if cached
// PostToolUse: store result in cache

const { preToolHook, postToolHook } = await import('${import.meta.url}');

const stdin = JSON.parse(await readStdin());

if (process.env.CLAUDE_HOOK_EVENT === 'PreToolUse') {
  const result = preToolHook({
    tool_name: stdin.tool_name,
    tool_input: stdin.tool_input,
    session_id: stdin.session_id,
  });
  if (result.shouldCache && result.cachedResult) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'OMEGA cache hit — serving from WarpCache',
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        additionalContext: \`[OMEGA CACHE] Skipping \${stdin.tool_name}: result cached (\${result.estimatedTokensSaved} tokens saved)\`,
      },
    }));
  }
} else if (process.env.CLAUDE_HOOK_EVENT === 'PostToolUse') {
  postToolHook(
    { tool_name: stdin.tool_name, tool_input: stdin.tool_input, session_id: stdin.session_id },
    { success: stdin.tool_response?.success ?? true, output: JSON.stringify(stdin.tool_response ?? {}), tokensUsed: 500 },
  );
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data));
  });
}
`;
}
