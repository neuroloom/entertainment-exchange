// Agent routes — agent CRUD, runs, autonomy levels
// Task 020-025: POST /agents, GET /agents, POST /agents/:id/runs, GET /agents/:id/runs
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import { AppError } from '../plugins/errorHandler.js';

const CreateAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  businessId: z.string().uuid().optional(),
  autonomyLevel: z.number().int().min(0).max(5).default(1),
  budgetDailyCents: z.number().int().min(0).default(0),
  metadata: z.record(z.unknown()).optional(),
});

const CreateRunSchema = z.object({
  goal: z.string().min(1),
});

const agents = new Map<string, any>();
const agentRuns = new Map<string, any[]>();
const auditEvents: any[] = [];

function writeAudit(ctx: any, action: string, resourceType: string, resourceId: string, businessId?: string, metadata?: Record<string, unknown>) {
  auditEvents.push({
    id: uuid(), tenantId: ctx.tenantId, businessId, actorType: ctx.actor.type,
    actorId: ctx.actor.id, action, resourceType, resourceId, metadata: metadata ?? {},
    createdAt: new Date().toISOString(),
  });
}

export async function agentRoutes(app: FastifyInstance) {
  app.post('/', async (req, reply) => {
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
    agents.set(agentId, agent);
    agentRuns.set(agentId, []);

    writeAudit(ctx, 'agent.create', 'agent', agentId, body.businessId ?? undefined);
    reply.status(201).send({ data: agent });
  });

  app.get('/', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const all = [...agents.values()].filter(a => a.tenantId === ctx.tenantId);
    reply.send({ data: all });
  });

  app.get('/:id', async (req, reply) => {
    const ctx = (req as any).ctx;
    const a = agents.get((req.params as any).id);
    if (!a || a.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');
    reply.send({ data: a });
  });

  app.post('/:id/runs', async (req, reply) => {
    const ctx = (req as any).ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    if (!ctx.actor.permissions.includes('agent:run')) throw AppError.forbidden('Missing agent:run permission');

    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const body = CreateRunSchema.parse(req.body);
    const runId = uuid();

    const run = {
      id: runId, tenantId: ctx.tenantId, businessId: agent.businessId,
      agentId: agent.id, status: 'created', goal: body.goal,
      costCents: 0, output: {}, startedAt: new Date().toISOString(), endedAt: null,
    };
    if (!agentRuns.has(agent.id)) agentRuns.set(agent.id, []);
    agentRuns.get(agent.id)!.push(run);

    writeAudit(ctx, 'agent.run', 'agent_run', runId, agent.businessId);
    reply.status(201).send({ data: run });
  });

  app.get('/:id/runs', async (req, reply) => {
    const ctx = (req as any).ctx;
    const agent = agents.get((req.params as any).id);
    if (!agent || agent.tenantId !== ctx.tenantId) throw AppError.notFound('Agent');

    const runs = agentRuns.get(agent.id) ?? [];
    reply.send({ data: runs });
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
