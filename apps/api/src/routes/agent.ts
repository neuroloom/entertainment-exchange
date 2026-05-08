// Agent routes — agent CRUD, runs, autonomy levels
// Task 020-025: POST /agents, GET /agents, POST /agents/:id/runs, GET /agents/:id/runs
// Sprint 3b: PATCH /agents/:id, DELETE /agents/:id, pagination on GET
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';
import { executeAgentRun, getPipelineStats, getPipelineVGDO } from '../services/agent-executor.js';
import { MemoryStore, AuditStore } from '../services/repo.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';

const CreateAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  businessId: z.string().uuid().optional(),
  autonomyLevel: z.number().int().min(0).max(5).default(1),
  budgetDailyCents: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

const UpdateAgentSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  autonomyLevel: z.number().int().min(0).max(5).optional(),
  budgetDailyCents: z.number().int().min(0).optional(),
});

const CreateRunSchema = z.object({
  goal: z.string().min(1),
});

const agents = new MemoryStore('agents');
const agentRuns = new Map<string, any[]>();
const auditEvents = new AuditStore();

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function agentRoutes(app: FastifyInstance) {
  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'role'],
        properties: {
          name: { type: 'string', minLength: 1 },
          role: { type: 'string', minLength: 1 },
          autonomyLevel: { type: 'integer', minimum: 0, maximum: 5 },
          budgetDailyCents: { type: 'integer', minimum: 0 },
          businessId: { type: 'string', format: 'uuid' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('agent:run')) throw AppError.forbidden('Missing agent:run permission');

    const body = CreateAgentSchema.parse(req.body);
    const agentId = uuid();

    const agent = {
      id: agentId, tenantId: ctx.tenantId, businessId: body.businessId ?? null,
      name: body.name, role: body.role,
      autonomyLevel: body.autonomyLevel, status: 'active',
      budgetDailyCents: body.budgetDailyCents, metadata: body.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    agents.set(agent);
    agentRuns.set(agentId, []);

    writeAudit(ctx, 'agent.create', 'agent', agentId, body.businessId ?? undefined);
    reply.status(201).send({ data: agent });
  });

  // Sprint 3b: pagination with ?limit=&offset=
  app.get('/', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const all = agents.all(ctx.tenantId);
    const p = paginate(req.query);
    const sliced = all.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, all.length, p));
  });

  app.get('/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const a = agents.get((req.params as any).id);
    if (!a || a.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');
    reply.send({ data: a });
  });

  // Sprint 3b: PATCH /agents/:id — update agent name, role, autonomyLevel, budgetDailyCents
  app.patch('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          role: { type: 'string', minLength: 1 },
          autonomyLevel: { type: 'integer', minimum: 0, maximum: 5 },
          budgetDailyCents: { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('agent:run')) throw AppError.forbidden('Missing agent:run permission');

    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const body = UpdateAgentSchema.parse(req.body);

    if (body.name !== undefined) agent.name = body.name;
    if (body.role !== undefined) agent.role = body.role;
    if (body.autonomyLevel !== undefined) agent.autonomyLevel = body.autonomyLevel;
    if (body.budgetDailyCents !== undefined) agent.budgetDailyCents = body.budgetDailyCents;

    agents.set(agent);
    writeAudit(ctx, 'agent.update', 'agent', agent.id, agent.businessId, { changed: Object.keys(body) });
    reply.send({ data: agent });
  });

  // Sprint 3b: DELETE /agents/:id — soft-delete (set status to 'inactive')
  app.delete('/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('agent:run')) throw AppError.forbidden('Missing agent:run permission');

    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    agent.status = 'inactive';
    agents.set(agent);
    writeAudit(ctx, 'agent.delete', 'agent', agent.id, agent.businessId);
    reply.send({ data: agent });
  });

  app.post('/:id/runs', {
    schema: {
      body: {
        type: 'object',
        required: ['goal'],
        properties: {
          goal: { type: 'string', minLength: 1 },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('agent:run')) throw AppError.forbidden('Missing agent:run permission');

    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const body = CreateRunSchema.parse(req.body);
    const runId = uuid();

    // Execute via OMEGA pipeline — caches similar goals, batches concurrent runs, routes to cheapest model
    const output = await executeAgentRun({
      runId, agentId: agent.id, agentName: agent.name, agentRole: agent.role,
      goal: body.goal, autonomyLevel: agent.autonomyLevel, budgetCents: agent.budgetDailyCents,
    });

    const run = {
      id: runId, tenantId: ctx.tenantId, businessId: agent.businessId,
      agentId: agent.id, status: output.cached ? 'completed_cached' : 'completed',
      goal: body.goal, costCents: output.costCents,
      output: { result: output.result, tokensIn: output.tokensIn, tokensOut: output.tokensOut,
        modelUsed: output.modelUsed, cached: output.cached,
        omegaQuality: output.omegaQuality, vgdoGrade: output.vgdoGrade, latencyMs: output.latencyMs },
      startedAt: new Date(Date.now() - output.latencyMs).toISOString(),
      endedAt: new Date().toISOString(),
    };
    if (!agentRuns.has(agent.id)) agentRuns.set(agent.id, []);
    agentRuns.get(agent.id)!.push(run);

    writeAudit(ctx, 'agent.run', 'agent_run', runId, agent.businessId,
      { cached: output.cached, model: output.modelUsed, costCents: output.costCents, omega: output.omegaQuality });
    reply.status(201).send({ data: run });
  });

  // OMEGA pipeline stats
  app.get('/pipeline/stats', async (req, reply) => {
    reply.send({ data: getPipelineStats() });
  });

  app.get('/pipeline/vgdo', async (req, reply) => {
    reply.send({ data: getPipelineVGDO() });
  });

  app.get('/:id/runs', async (req, reply) => {
    const ctx = (req as any).ctx;
    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const runs = agentRuns.get(agent.id) ?? [];
    const p = paginate(req.query);
    const sliced = runs.slice(p.offset, p.offset + p.limit);
    reply.send(paginatedResponse(sliced, runs.length, p));
  });

  app.get('/:id/runs/:runId', async (req, reply) => {
    const ctx = (req as any).ctx;
    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const run = (agentRuns.get(agent.id) ?? []).find(r => r.id === (req.params as any).runId);
    if (!run) throw AppError.notFound('AgentRun');
    reply.send({ data: run });
  });
}
