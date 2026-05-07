// Paginate plugin — typed pagination helpers for reading ?limit and ?offset from query
import type { FastifyRequest } from 'fastify';

export interface Pagination {
  limit: number;
  offset: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

/**
 * Read ?limit and ?offset from the request query string.
 * Clamps limit between 1 and 100, defaults to 20.
 * offset is clamped to non-negative integers.
 */
export function paginate(query: FastifyRequest['query']): Pagination {
  const raw = query as Record<string, unknown> | undefined;

  let limit = DEFAULT_LIMIT;
  let offset = 0;

  if (raw) {
    if (raw.limit !== undefined) {
      const parsed = Number(raw.limit);
      if (!Number.isNaN(parsed)) {
        limit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.floor(Math.abs(parsed))));
      }
    }

    if (raw.offset !== undefined) {
      const parsed = Number(raw.offset);
      if (!Number.isNaN(parsed)) {
        offset = Math.max(0, Math.floor(Math.abs(parsed)));
      }
    }
  }

  return { limit, offset };
}

/**
 * Build a type-safe paginated response envelope.
 */
export function paginatedResponse<T>(
  data: T[],
  total: number,
  pagination: Pagination,
): PaginatedResponse<T> {
  return {
    data,
    total,
    limit: pagination.limit,
    offset: pagination.offset,
  };
}
