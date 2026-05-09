// Notification routes — in-app notifications, preferences, and delivery management
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { notificationService } from '../services/notification.service.js';

const UpdatePrefsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  inAppNotifications: z.boolean().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export async function notificationRoutes(app: FastifyInstance) {
  // GET /notifications — list notifications for the current user
  app.get('/notifications', async (req, reply) => {
    const ctx = req.ctx;
    if (!ctx?.tenantId) throw AppError.tenantRequired();
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const query = req.query as Record<string, string>;
    const unreadOnly = query.unread === 'true';
    const all = notificationService.getForUser(ctx.tenantId, userId, unreadOnly);

    const p = paginate(req.query);
    const sliced = all.slice(p.offset, p.offset + p.limit);

    reply.send({
      data: sliced,
      meta: {
        ...paginatedResponse(sliced, all.length, p),
        unreadCount: notificationService.getUnreadCount(ctx.tenantId, userId),
      },
    });
  });

  // POST /notifications/:id/read — mark a notification as read
  app.post('/notifications/:id/read', async (req, reply) => {
    const ctx = req.ctx;
    const ok = notificationService.markRead(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Notification');
    reply.send({ data: { read: true } });
  });

  // POST /notifications/read-all — mark all as read for current user
  app.post('/notifications/read-all', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const count = notificationService.markAllRead(ctx.tenantId, userId);
    reply.send({ data: { markedRead: count } });
  });

  // GET /notifications/preferences — get notification preferences
  app.get('/notifications/preferences', async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    reply.send({ data: notificationService.getUserPrefs(userId) });
  });

  // PATCH /notifications/preferences — update notification preferences
  app.patch('/notifications/preferences', {
    schema: {
      body: {
        type: 'object',
        properties: {
          emailNotifications: { type: 'boolean' },
          smsNotifications: { type: 'boolean' },
          inAppNotifications: { type: 'boolean' },
          email: { type: 'string' },
          phone: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const userId = ctx.actor.userId ?? ctx.actor.id;
    if (!userId || userId === 'anonymous') throw AppError.unauthenticated('User identity required');

    const prefs = notificationService.setUserPrefs(userId, UpdatePrefsSchema.parse(req.body));
    reply.send({ data: prefs });
  });
}
