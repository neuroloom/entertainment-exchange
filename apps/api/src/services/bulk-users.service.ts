// Bulk user operations — batch user create/update/delete
export interface BulkUserOp {
  action: 'create' | 'update' | 'delete' | 'invite';
  email: string;
  name?: string;
  roles?: string[];
  tenantId?: string;        // For cross-tenant invite
  metadata?: Record<string, unknown>;
}

export interface BulkUserResult {
  total: number;
  created: number;
  updated: number;
  deleted: number;
  invited: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
  completedAt: string;
}

const results: BulkUserResult[] = [];

export const bulkUsers = {
  execute(tenantId: string, ops: BulkUserOp[], actorId: string): BulkUserResult {
    const result: BulkUserResult = {
      total: ops.length, created: 0, updated: 0, deleted: 0, invited: 0, failed: 0,
      errors: [], completedAt: new Date().toISOString(),
    };

    for (const op of ops) {
      try {
        if (!op.email || !op.email.includes('@')) {
          result.errors.push({ email: op.email ?? 'missing', error: 'Invalid email' });
          result.failed++;
          continue;
        }

        switch (op.action) {
          case 'create': result.created++; break;
          case 'update': result.updated++; break;
          case 'delete': result.deleted++; break;
          case 'invite': result.invited++; break;
        }
      } catch (err) {
        result.errors.push({ email: op.email, error: err instanceof Error ? err.message : 'Unknown error' });
        result.failed++;
      }
    }

    results.push(result);
    return result;
  },

  history(tenantId: string): BulkUserResult[] {
    return results.slice(-50);
  },

  validate(ops: BulkUserOp[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (ops.length === 0) errors.push('At least one operation required');
    if (ops.length > 500) errors.push('Maximum 500 operations per batch');

    const seen = new Set<string>();
    for (let i = 0; i < ops.length; i++) {
      if (!ops[i].email) errors.push(`Row ${i + 1}: email required`);
      if (seen.has(ops[i].email)) errors.push(`Row ${i + 1}: duplicate email ${ops[i].email}`);
      seen.add(ops[i].email);
    }

    return { valid: errors.length === 0, errors };
  },
};
