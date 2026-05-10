// Agent Executor — Real LLM inference wrapped with OMEGA Output Maximizer
// WarpCache absorbs repeated/similar agent goals, BatchProcessor coalesces concurrent runs,
// AutoRouter selects cheapest capable model for the task.

import Anthropic from '@anthropic-ai/sdk';
import { OutputMaximizer } from '@entex/orchestration';
import { computeVGDO } from '@entex/orchestration';
import type { InferenceRequest, MetricSnapshot, VGDOScore } from '@entex/orchestration';

const anthropic = new Anthropic({
  baseURL: process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? 'no-key',
});

const MODEL_TIERS = {
  haiku: { model: 'claude-haiku-4-5-20251001', costPerMtok: 1.0, capability: 'simple' },
  sonnet: { model: 'claude-sonnet-4-6', costPerMtok: 3.0, capability: 'standard' },
  opus: { model: 'claude-opus-4-6', costPerMtok: 15.0, capability: 'complex' },
};

export interface AgentRunContext {
  runId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  goal: string;
  autonomyLevel: number;
  budgetCents: number;
}

export interface AgentRunOutput {
  runId: string;
  result: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  modelUsed: string;
  cached: boolean;
  omegaQuality: number;
  vgdoGrade: string;
  latencyMs: number;
}

// ── OMEGA Pipeline (shared across all agent runs) ──────────────────────────

let maximizer: OutputMaximizer | null = null;

function getPipeline(): OutputMaximizer {
  if (!maximizer) {
    maximizer = new OutputMaximizer({
      batchSize: 8,
      lruCacheSize: 10_000,
      semanticCacheSize: 50_000,
      similarityThreshold: 0.92,
      maxConcurrent: 64,
    });

    // Register role-based routing skills
    const roles = [
      ['booking-closer', 'negotiate close confirm contract booking client communication'],
      ['event-ops', 'coordinate logistics venue schedule timeline vendor management'],
      ['finance-ledger', 'double entry debit credit journal revenue recognition stripe'],
      ['marketplace-diligence', 'evaluate listing evidence tier verification due diligence'],
      ['rights-passport', 'legal anchor hash rights asset passport issuance chain of title'],
      ['source-of-truth', 'audit trail data consistency validation reconciliation'],
    ];
    for (const [subtype, desc] of roles) maximizer.router.registerSkill(subtype, desc);

    // Hook real Anthropic SDK as the model function
    maximizer.setModelFn(async (req: InferenceRequest) => {
      const tier = req.meta?.tier as keyof typeof MODEL_TIERS ?? 'haiku';
      const { model } = MODEL_TIERS[tier];

      const response = await anthropic.messages.create({
        model,
        max_tokens: req.options?.maxTokens ?? 1024,
        system: req.system ?? 'You are an entertainment business agent. Be concise and accurate.',
        messages: [{ role: 'user', content: req.prompt }],
      });

      const text = response.content
        .filter(c => c.type === 'text')
        .map(c => (c as { text: string }).text)
        .join('\n');

      return text;
    });
  }
  return maximizer;
}

// ── Agent Run Execution ────────────────────────────────────────────────────

export async function executeAgentRun(ctx: AgentRunContext): Promise<AgentRunOutput> {
  const pipeline = getPipeline();
  const startTime = performance.now();

  // 1. AutoRouter: classify the goal, pick best agent role + cheapest capable model
  const route = pipeline.router.route(`${ctx.agentRole} ${ctx.goal}`);
  const tier = ctx.autonomyLevel >= 4 ? 'opus' : ctx.autonomyLevel >= 2 ? 'sonnet' : 'haiku';

  // 2. Build system prompt from agent role
  const systemPrompt = `You are "${ctx.agentName}", a ${ctx.agentRole} agent with autonomy level ${ctx.autonomyLevel}/5.
Budget: ${ctx.budgetCents} cents. Role: ${route.subtype}. Be thorough but cost-efficient.`;

  // 3. Run through OMEGA pipeline (cached → batched → model)
  const response = await pipeline.infer({
    model: MODEL_TIERS[tier].model,
    prompt: ctx.goal,
    system: systemPrompt,
    options: { maxTokens: 1024 },
    meta: { tier, runId: ctx.runId, agentId: ctx.agentId, role: ctx.agentRole },
  });

  // 4. Calculate real cost (in millicents for precision)
  const costPerTok = MODEL_TIERS[tier].costPerMtok / 1_000_000;
  const costCents = Math.round((response.promptTokens + response.completionTokens) * costPerTok * 10000) / 10000;

  // 5. VGDO quality score
  const stats = pipeline.getStats();
  const vgdo = computeVGDO(pipeline.omega, stats.hitRate, pipeline.semantic.hitRate, stats.hitRate);

  const latencyMs = Math.round(performance.now() - startTime);

  return {
    runId: ctx.runId,
    result: response.response,
    tokensIn: response.promptTokens,
    tokensOut: response.completionTokens,
    costCents,
    modelUsed: MODEL_TIERS[tier].model,
    cached: response.cached,
    omegaQuality: pipeline.omega,
    vgdoGrade: vgdo.grade,
    latencyMs,
  };
}

export function getPipelineStats(): MetricSnapshot {
  return getPipeline().getStats();
}

export function getPipelineVGDO(): VGDOScore {
  return getPipeline().getVGDO();
}
