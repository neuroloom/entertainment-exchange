// Slack integration routes — configure webhook and test notifications
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { slackService } from '../services/slack.service.js';

const SlackConfigSchema = z.object({
  webhookUrl: z.string().url(),
  channel: z.string().optional(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().optional(),
});

export async function slackRoutes(app: FastifyInstance) {
  app.put('/integrations/slack', {
    schema: {
      body: {
        type: 'object',
        required: ['webhookUrl', 'events'],
        properties: {
          webhookUrl: { type: 'string', format: 'uri' },
          channel: { type: 'string' },
          events: { type: 'array', items: { type: 'string' }, minItems: 1 },
          enabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = SlackConfigSchema.parse(req.body);
    slackService.setConfig({
      tenantId: ctx.tenantId, webhookUrl: body.webhookUrl,
      channel: body.channel, events: body.events,
      enabled: body.enabled ?? true,
    });
    reply.send({ data: slackService.getConfig(ctx.tenantId) });
  });

  app.get('/integrations/slack', async (req, reply) => {
    const ctx = req.ctx;
    const config = slackService.getConfig(ctx.tenantId);
    if (!config) throw AppError.notFound('Slack integration not configured');
    // Don't expose full webhook URL
    reply.send({
      data: {
        channel: config.channel, events: config.events, enabled: config.enabled,
        configured: true,
      },
    });
  });

  app.delete('/integrations/slack', async (req, reply) => {
    const ctx = req.ctx;
    slackService.deleteConfig(ctx.tenantId);
    reply.send({ data: { deleted: true } });
  });

  app.post('/integrations/slack/test', async (req, reply) => {
    const ctx = req.ctx;
    const ok = await slackService.notify(ctx.tenantId, 'system.test', {
      message: 'Slack integration test from EntEx',
      timestamp: new Date().toISOString(),
    });
    reply.send({ data: { sent: ok } });
  });
}
