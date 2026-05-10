// Agent tests — CRUD, runs, autonomy levels, OMEGA pipeline
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

// Mock the agent-executor to avoid calling real Anthropic SDK
const { mockExecuteAgentRun, mockGetPipelineStats, mockGetPipelineVGDO } = vi.hoisted(() => ({
  mockExecuteAgentRun: vi.fn(),
  mockGetPipelineStats: vi.fn(),
  mockGetPipelineVGDO: vi.fn(),
}));

vi.mock('../services/agent-executor.js', () => ({
  executeAgentRun: mockExecuteAgentRun,
  getPipelineStats: mockGetPipelineStats,
  getPipelineVGDO: mockGetPipelineVGDO,
}));

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function headers(tenantId: string, permissions: string, actorId = 'test-agent-user') {
  return {
    'x-tenant-id': tenantId,
    'x-actor-id': actorId,
    'x-actor-type': 'human',
    'x-actor-permissions': permissions,
  };
}

describe('Agent routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Create Agent ────────────────────────────────────────────────────────

  describe('POST /api/v1/agents', () => {
    it('creates an agent with 201 and includes autonomyLevel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: {
          name: 'Booking Closer',
          role: 'booking-closer',
          autonomyLevel: 3,
          budgetDailyCents: 500,
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.name).toBe('Booking Closer');
      expect(body.data.autonomyLevel).toBe(3);
      expect(body.data.status).toBe('active');
      expect(body.data.tenantId).toBe(TENANT_A);
      expect(body.data.id).toBeDefined();
    });

    it('returns 403 when missing agent:run permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'read'),
        payload: {
          name: 'Agent',
          role: 'tester',
        },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 400 when x-tenant-id header is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: { 'x-actor-permissions': 'agent:run' },
        payload: {
          name: 'NoTenantAgent',
          role: 'orphan',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('TENANT_REQUIRED');
    });
  });

  // ── List Agents ─────────────────────────────────────────────────────────

  describe('GET /api/v1/agents', () => {
    beforeAll(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'Alpha Agent', role: 'alpha', autonomyLevel: 1 },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_B, 'agent:run'),
        payload: { name: 'Beta Agent', role: 'beta', autonomyLevel: 2 },
      });
    });

    it('returns tenant-scoped agents only', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.data)).toBe(true);
      for (const agent of body.data) {
        expect(agent.tenantId).toBe(TENANT_A);
      }
    });

    it('returns empty list for tenant with no agents', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: headers('no-tenant-xxxx-xxxx-xxxxxxxxxxxx', 'agent:run'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toEqual([]);
    });
  });

  // ── Create Agent Run ────────────────────────────────────────────────────

  describe('POST /api/v1/agents/:id/runs', () => {
    let agentId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'Runner', role: 'runner', autonomyLevel: 4 },
      });
      agentId = JSON.parse(res.payload).data.id;

      mockExecuteAgentRun.mockResolvedValue({
        runId: 'mock-run-id',
        result: 'Task completed successfully.',
        tokensIn: 150,
        tokensOut: 300,
        costCents: 0.045,
        modelUsed: 'claude-opus-4-6',
        cached: false,
        omegaQuality: 0.85,
        vgdoGrade: 'A',
        latencyMs: 1200,
      });
    });

    it('creates a run and returns OMEGA pipeline output', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${agentId}/runs`,
        headers: headers(TENANT_A, 'agent:run'),
        payload: { goal: 'Analyze the quarterly revenue report' },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.status).toMatch(/completed/);
      expect(body.data.goal).toBe('Analyze the quarterly revenue report');
      expect(body.data.output).toBeDefined();
      expect(body.data.output.result).toBe('Task completed successfully.');
      expect(body.data.output.modelUsed).toBe('claude-opus-4-6');
      expect(body.data.output.vgdoGrade).toBe('A');
      expect(body.data.output.omegaQuality).toBe(0.85);
      expect(body.data.costCents).toBe(0.045);
    });

    it('returns 403 when missing agent:run permission', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${agentId}/runs`,
        headers: headers(TENANT_A, 'read'),
        payload: { goal: 'Do something' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns 404 when agent does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents/nonexistent-id/runs',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { goal: 'Do something' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── List Runs ───────────────────────────────────────────────────────────

  describe('GET /api/v1/agents/:id/runs', () => {
    let agentId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'RunLister', role: 'lister', autonomyLevel: 2 },
      });
      agentId = JSON.parse(res.payload).data.id;

      mockExecuteAgentRun.mockResolvedValue({
        runId: 'run-1',
        result: 'OK',
        tokensIn: 10,
        tokensOut: 20,
        costCents: 0.01,
        modelUsed: 'claude-haiku-4-5-20251001',
        cached: true,
        omegaQuality: 0.5,
        vgdoGrade: 'C',
        latencyMs: 200,
      });

      await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${agentId}/runs`,
        headers: headers(TENANT_A, 'agent:run'),
        payload: { goal: 'Run 1' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${agentId}/runs`,
        headers: headers(TENANT_A, 'agent:run'),
        payload: { goal: 'Run 2' },
      });
    });

    it('returns all runs for an agent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/agents/${agentId}/runs`,
        headers: headers(TENANT_A, 'agent:run'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(2);
    });

    it('returns 404 for non-existent agent', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/no-such-agent/runs',
        headers: headers(TENANT_A, 'agent:run'),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── Pipeline Stats ──────────────────────────────────────────────────────

  describe('GET /api/v1/agents/pipeline/stats', () => {
    beforeAll(() => {
      mockGetPipelineStats.mockReturnValue({
        totalRequests: 100,
        lruHits: 40,
        semanticHits: 30,
        modelHits: 25,
        ollamaCalls: 0,
        errors: 5,
        avgLatencyMs: 350,
        p95LatencyMs: 800,
        hitRate: 0.7,
        tokensPerSecond: 2000,
        timestamp: Date.now(),
      });
    });

    it('returns pipeline stats with expected fields', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/pipeline/stats',
        headers: headers(TENANT_A, 'agent:run'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.totalRequests).toBe(100);
      expect(body.data.hitRate).toBe(0.7);
      expect(body.data.avgLatencyMs).toBe(350);
      expect(body.data.lruHits).toBe(40);
      expect(body.data.semanticHits).toBe(30);
      expect(typeof body.data.timestamp).toBe('number');
    });
  });

  // ── Pipeline VGDO ───────────────────────────────────────────────────────

  describe('GET /api/v1/agents/pipeline/vgdo', () => {
    beforeAll(() => {
      mockGetPipelineVGDO.mockReturnValue({
        omega: 0.92,
        dnaFitness: 0.88,
        sIso: 0.75,
        deltaC: 0.04,
        vgdo: 0.91,
        grade: 'A',
      });
    });

    it('returns VGDO score with a grade', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/pipeline/vgdo',
        headers: headers(TENANT_A, 'agent:run'),
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data).toBeDefined();
      expect(body.data.omega).toBe(0.92);
      expect(body.data.vgdo).toBe(0.91);
      expect(body.data.grade).toBe('A');
      expect(['S', 'A', 'B', 'C', 'D', 'F']).toContain(body.data.grade);
    });

    it('returns 401 without auth headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/pipeline/vgdo',
        // No x-actor-id or x-actor-permissions
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ── Pipeline Stats without auth ──────────────────────────────────────────

  describe('GET /api/v1/agents/pipeline/stats (no auth)', () => {
    it('returns 401 without auth headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/agents/pipeline/stats',
        // No x-actor-id or x-actor-permissions
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  // ── PATCH /api/v1/agents/:id ─────────────────────────────────────────────

  describe('PATCH /api/v1/agents/:id', () => {
    let agentId: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'Patchable Agent', role: 'patcher', autonomyLevel: 2 },
      });
      agentId = JSON.parse(res.payload).data.id;
    });

    it('returns 200 updating agent fields', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${agentId}`,
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'Patched Agent', autonomyLevel: 4 },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.data.name).toBe('Patched Agent');
      expect(body.data.autonomyLevel).toBe(4);
      expect(body.data.role).toBe('patcher'); // unchanged
    });

    it('returns 404 for nonexistent agent', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/v1/agents/00000000-0000-0000-0000-000000000000',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'Ghost Agent' },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 without agent:run permission', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/agents/${agentId}`,
        headers: headers(TENANT_A, 'read'),
        payload: { name: 'Should Not Update' },
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.payload);
      expect(body.error.code).toBe('FORBIDDEN');
    });
  });

  // ── Run on inactive agent ────────────────────────────────────────────────

  describe('POST /api/v1/agents/:id/runs — inactive agent', () => {
    it('returns 400 when agent is not active', async () => {
      // Create an agent and then delete it (sets status=inactive)
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/agents',
        headers: headers(TENANT_A, 'agent:run'),
        payload: { name: 'DeactivateMe', role: 'temp', autonomyLevel: 1 },
      });
      const inactiveId = JSON.parse(createRes.payload).data.id;

      // Set as inactive via DELETE
      await app.inject({
        method: 'DELETE',
        url: `/api/v1/agents/${inactiveId}`,
        headers: headers(TENANT_A, 'agent:run'),
      });

      // Attempt to create a run on the inactive agent
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/agents/${inactiveId}/runs`,
        headers: headers(TENANT_A, 'agent:run'),
        payload: { goal: 'Run on inactive agent' },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
