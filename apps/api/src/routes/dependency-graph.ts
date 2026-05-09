// Dependency graph — service health and relationship visualization data
import type { FastifyInstance } from 'fastify';
import { pingPg } from '../services/repo.js';

interface ServiceNode { id: string; label: string; status: 'healthy' | 'degraded' | 'down'; latencyMs: number; dependsOn: string[]; }

export async function dependencyGraphRoutes(app: FastifyInstance) {
  app.get('/system/dependencies', async (_req, reply) => {
    const nodes: ServiceNode[] = [];
    const start = Date.now();

    // PostgreSQL
    const pgOk = await pingPg();
    nodes.push({ id: 'postgresql', label: 'PostgreSQL', status: pgOk ? 'healthy' : 'down', latencyMs: Date.now() - start, dependsOn: [] });

    // In-memory stores (internal, always healthy)
    nodes.push({ id: 'memory-stores', label: 'In-Memory Stores', status: 'healthy', latencyMs: 0, dependsOn: [] });

    // JWT auth (self-contained, always healthy)
    nodes.push({ id: 'jwt-auth', label: 'JWT Authentication', status: 'healthy', latencyMs: 0, dependsOn: [] });

    // API (this process)
    nodes.push({ id: 'api-server', label: 'API Server', status: 'healthy', latencyMs: 0, dependsOn: ['postgresql', 'memory-stores', 'jwt-auth'] });

    // Routes layer
    nodes.push({ id: 'routes', label: 'Route Handlers', status: 'healthy', latencyMs: 0, dependsOn: ['api-server'] });

    // Determine overall: degraded if any dependency is down
    const anyDown = nodes.some(n => n.status === 'down');
    const anyDegraded = nodes.some(n => n.status === 'degraded');

    reply.send({
      data: {
        nodes,
        overall: anyDown ? 'unhealthy' : anyDegraded ? 'degraded' : 'healthy',
        generatedAt: new Date().toISOString(),
      },
    });
  });

  app.get('/system/info', async (_req, reply) => {
    const mem = process.memoryUsage();
    reply.send({
      data: {
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
          rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        },
        env: process.env.NODE_ENV ?? 'development',
      },
    });
  });
}
