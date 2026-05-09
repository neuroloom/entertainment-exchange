// Attachment service — file/document storage with entity linking
// In-memory store (production: S3/GCS with DB metadata)
import { v4 as uuid } from 'uuid';

export interface Attachment {
  id: string;
  tenantId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  entityType: 'booking' | 'rights_anchor' | 'listing' | 'contract';
  entityId: string;
  data: Buffer;            // In-memory; production → object store
  metadata: Record<string, unknown>;
  uploadedBy: string;
  createdAt: string;
}

const attachments: Attachment[] = [];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PER_TENANT = 1000;

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/csv',
  'application/json',
]);

export const attachmentService = {
  upload(opts: {
    tenantId: string;
    fileName: string;
    mimeType: string;
    data: Buffer;
    entityType: Attachment['entityType'];
    entityId: string;
    uploadedBy: string;
    metadata?: Record<string, unknown>;
  }): { attachment: Attachment; error?: undefined } | { attachment: null; error: string } {
    if (!ALLOWED_TYPES.has(opts.mimeType)) {
      return { attachment: null, error: `Unsupported file type: ${opts.mimeType}` };
    }
    if (opts.data.length > MAX_FILE_SIZE) {
      return { attachment: null, error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
    }
    const tenantCount = attachments.filter(a => a.tenantId === opts.tenantId).length;
    if (tenantCount >= MAX_PER_TENANT) {
      return { attachment: null, error: 'Tenant attachment limit reached' };
    }

    const a: Attachment = {
      id: uuid(), tenantId: opts.tenantId,
      fileName: opts.fileName, mimeType: opts.mimeType, sizeBytes: opts.data.length,
      entityType: opts.entityType, entityId: opts.entityId,
      data: opts.data, uploadedBy: opts.uploadedBy,
      metadata: opts.metadata ?? {}, createdAt: new Date().toISOString(),
    };
    attachments.push(a);
    return { attachment: a };
  },

  get(id: string, tenantId: string): Attachment | undefined {
    return attachments.find(a => a.id === id && a.tenantId === tenantId);
  },

  getMetadata(id: string, tenantId: string): Omit<Attachment, 'data'> | undefined {
    const a = this.get(id, tenantId);
    if (!a) return undefined;
    const { data, ...meta } = a;
    return meta;
  },

  listByEntity(entityType: string, entityId: string, tenantId: string): Omit<Attachment, 'data'>[] {
    return attachments
      .filter(a => a.tenantId === tenantId && a.entityType === entityType && a.entityId === entityId)
      .map(({ data, ...meta }) => meta);
  },

  listByTenant(tenantId: string): Omit<Attachment, 'data'>[] {
    return attachments
      .filter(a => a.tenantId === tenantId)
      .map(({ data, ...meta }) => meta);
  },

  delete(id: string, tenantId: string): boolean {
    const idx = attachments.findIndex(a => a.id === id && a.tenantId === tenantId);
    if (idx === -1) return false;
    attachments.splice(idx, 1);
    return true;
  },

  stats(tenantId: string): { count: number; totalBytes: number; byType: Record<string, number> } {
    const tenant = attachments.filter(a => a.tenantId === tenantId);
    const byType: Record<string, number> = {};
    let totalBytes = 0;
    for (const a of tenant) {
      totalBytes += a.sizeBytes;
      byType[a.mimeType] = (byType[a.mimeType] ?? 0) + 1;
    }
    return { count: tenant.length, totalBytes, byType };
  },
};
