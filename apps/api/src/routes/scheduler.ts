// Scheduler routes — manage and trigger background tasks
import { params } from '../plugins/requestContext.js';
import type { FastifyInstance } from 'fastify';
import { scheduler } from '../services/scheduled-tasks.service.js';

export async function schedulerRoutes(app: FastifyInstance) {
  app.get('/scheduler/tasks', async (_req, reply) => {
    reply.send({ data: scheduler.listTasks() });
  });

  app.post('/scheduler/tasks/:name/run', async (req, reply) => {
    const name = params(req).name;
    const result = await scheduler.runNow(name);
    reply.send({ data: result });
  });
}
