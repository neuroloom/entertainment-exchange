// Shared Types — Domain types used by all Entertainment Business Exchange packages
// Task 002: Branded IDs, AppError, DomainEvent, RequestContext

// Branded ID types
export type TenantId = string & { readonly __brand: 'TenantId' };
export type BusinessId = string & { readonly __brand: 'BusinessId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type BookingId = string & { readonly __brand: 'BookingId' };
export type AgentId = string & { readonly __brand: 'AgentId' };
export type ListingId = string & { readonly __brand: 'ListingId' };
export type PassportId = string & { readonly __brand: 'PassportId' };
export type JournalId = string & { readonly __brand: 'JournalId' };

export function asTenantId(id: string): TenantId { return id as TenantId; }
export function asBusinessId(id: string): BusinessId { return id as BusinessId; }
export function asUserId(id: string): UserId { return id as UserId; }

// Error model
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static forbidden(msg = 'Forbidden'): AppError { return new AppError('FORBIDDEN', msg, 403); }
  static notFound(resource: string): AppError { return new AppError('NOT_FOUND', `${resource} not found`, 404); }
  static invalid(msg: string): AppError { return new AppError('INVALID_INPUT', msg, 400); }
  static conflict(msg: string): AppError { return new AppError('CONFLICT', msg, 409); }
  static internal(msg = 'Internal error'): AppError { return new AppError('INTERNAL', msg, 500); }
}

// Request context
export interface RequestContext {
  tenantId: TenantId;
  userId: UserId;
  businessId?: BusinessId;
  actorType: 'human' | 'agent' | 'system' | 'provider';
  actorId: string;
  permissions: string[];
  traceId: string;
}

// Domain event envelope
export interface DomainEvent<TPayload = unknown> {
  id: string;
  type: string;
  tenantId: string;
  businessId?: string;
  actorType: 'human' | 'agent' | 'system' | 'provider';
  actorId?: string;
  resourceType: string;
  resourceId: string;
  traceId: string;
  occurredAt: string;
  payload: TPayload;
}

// Entity status
export type EntityStatus = 'active' | 'inactive' | 'suspended' | 'archived';

// Currency — all amounts in cents
export type Cents = number;
export type Currency = 'USD';

// Permission type
export type Permission =
  | 'business:create' | 'business:manage'
  | 'booking:create' | 'booking:confirm'
  | 'contract:generate' | 'contract:send'
  | 'payment:create' | 'payout:release'
  | 'agent:run' | 'agent:approve'
  | 'listing:publish' | 'deal:close'
  | 'rights:issue' | 'audit:view';

// Pagination
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
