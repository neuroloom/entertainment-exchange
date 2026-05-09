// Attachment routes — file upload, download, list, delete
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../plugins/errorHandler.js';
import { params } from '../plugins/requestContext.js';
import { paginate, paginatedResponse } from '../plugins/paginate.plugin.js';
import { attachmentService } from '../services/attachments.service.js';

const UploadAttachmentSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  data: z.string(),
  entityType: z.enum(['booking', 'rights_anchor', 'listing', 'contract']),
  entityId: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export async function attachmentRoutes(app: FastifyInstance) {
  // POST /attachments — upload a file (base64 in JSON body for simplicity)
  app.post('/attachments', {
    schema: {
      body: {
        type: 'object',
        required: ['fileName', 'mimeType', 'data', 'entityType', 'entityId'],
        properties: {
          fileName: { type: 'string', minLength: 1 },
          mimeType: { type: 'string', minLength: 1 },
          data: { type: 'string' },  // base64
          entityType: { type: 'string', enum: ['booking', 'rights_anchor', 'listing', 'contract'] },
          entityId: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = req.ctx;
    const body = UploadAttachmentSchema.parse(req.body);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.data, 'base64');
    } catch {
      throw AppError.invalid('Invalid base64 data');
    }

    const result = attachmentService.upload({
      tenantId: ctx.tenantId, fileName: body.fileName, mimeType: body.mimeType,
      data: buffer, entityType: body.entityType, entityId: body.entityId,
      uploadedBy: ctx.actor.id, metadata: body.metadata,
    });

    if (result.error) throw AppError.invalid(result.error);
    const { attachment } = result;
    if (!attachment) throw AppError.invalid('Upload failed');
    reply.status(201).send({
      data: {
        id: attachment.id, fileName: attachment.fileName,
        mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes,
        entityType: attachment.entityType, entityId: attachment.entityId,
        createdAt: attachment.createdAt,
      },
    });
  });

  // GET /attachments — list all attachments for tenant
  app.get('/attachments', async (req, reply) => {
    const ctx = req.ctx;
    const query = req.query as Record<string, string>;
    let all = attachmentService.listByTenant(ctx.tenantId);
    if (query.entityType && query.entityId) {
      all = attachmentService.listByEntity(query.entityType, query.entityId, ctx.tenantId);
    }
    const p = paginate(req.query);
    reply.send(paginatedResponse(all.slice(p.offset, p.offset + p.limit), all.length, p));
  });

  // GET /attachments/:id — download metadata
  app.get('/attachments/:id', async (req, reply) => {
    const ctx = req.ctx;
    const meta = attachmentService.getMetadata(params(req).id, ctx.tenantId);
    if (!meta) throw AppError.notFound('Attachment');
    reply.send({ data: meta });
  });

  // GET /attachments/:id/download — download file content
  app.get('/attachments/:id/download', async (req, reply) => {
    const ctx = req.ctx;
    const a = attachmentService.get(params(req).id, ctx.tenantId);
    if (!a) throw AppError.notFound('Attachment');
    reply
      .header('Content-Type', a.mimeType)
      .header('Content-Disposition', `attachment; filename="${a.fileName}"`)
      .header('Content-Length', a.sizeBytes)
      .send(a.data);
  });

  // DELETE /attachments/:id — delete an attachment
  app.delete('/attachments/:id', async (req, reply) => {
    const ctx = req.ctx;
    const ok = attachmentService.delete(params(req).id, ctx.tenantId);
    if (!ok) throw AppError.notFound('Attachment');
    reply.send({ data: { deleted: true } });
  });

  // GET /attachments/stats — storage stats
  app.get('/attachments/stats', async (req, reply) => {
    const ctx = req.ctx;
    reply.send({ data: attachmentService.stats(ctx.tenantId) });
  });
}
