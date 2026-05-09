// Custom fields — extensible entity schema for tenants
import { v4 as uuid } from 'uuid';

export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'select' | 'url';

export interface CustomFieldDefinition {
  id: string;
  tenantId: string;
  entityType: 'business' | 'booking' | 'listing' | 'agent';
  name: string;
  key: string;           // camelCase field key
  fieldType: FieldType;
  required: boolean;
  options?: string[];    // For 'select' type
  defaultValue?: string;
  order: number;
  createdAt: string;
}

const definitions: CustomFieldDefinition[] = [];

export const customFields = {
  define(opts: Omit<CustomFieldDefinition, 'id' | 'createdAt'>): CustomFieldDefinition {
    const existing = definitions.find(
      d => d.tenantId === opts.tenantId && d.entityType === opts.entityType && d.key === opts.key,
    );
    if (existing) return existing;

    const def: CustomFieldDefinition = {
      ...opts, id: uuid(), createdAt: new Date().toISOString(),
    };
    definitions.push(def);
    return def;
  },

  getDefinitions(tenantId: string, entityType?: string): CustomFieldDefinition[] {
    return definitions
      .filter(d => d.tenantId === tenantId && (!entityType || d.entityType === entityType))
      .sort((a, b) => a.order - b.order);
  },

  getDefinition(id: string, tenantId: string): CustomFieldDefinition | undefined {
    return definitions.find(d => d.id === id && d.tenantId === tenantId);
  },

  deleteDefinition(id: string, tenantId: string): boolean {
    const idx = definitions.findIndex(d => d.id === id && d.tenantId === tenantId);
    if (idx === -1) return false;
    definitions.splice(idx, 1);
    return true;
  },

  validateAndApply(entityType: string, tenantId: string, data: Record<string, unknown>): {
    valid: boolean;
    enriched: Record<string, unknown>;
    errors: string[];
  } {
    const defs = definitions.filter(d => d.tenantId === tenantId && d.entityType === entityType);
    const errors: string[] = [];
    const customValues: Record<string, unknown> = {};

    for (const def of defs) {
      const rawVal = data[def.key];
      if (rawVal === undefined || rawVal === null) {
        if (def.required) errors.push(`${def.name} (${def.key}) is required`);
        continue;
      }

      switch (def.fieldType) {
        case 'number': {
          const n = Number(rawVal);
          if (isNaN(n)) errors.push(`${def.name} must be a number`);
          else customValues[def.key] = n;
          break;
        }
        case 'boolean':
          customValues[def.key] = rawVal === true || rawVal === 'true';
          break;
        case 'select':
          if (def.options && !def.options.includes(String(rawVal))) {
            errors.push(`${def.name} must be one of: ${def.options.join(', ')}`);
          } else {
            customValues[def.key] = String(rawVal);
          }
          break;
        case 'date': {
          const d = new Date(String(rawVal));
          if (isNaN(d.getTime())) errors.push(`${def.name} must be a valid date`);
          else customValues[def.key] = String(rawVal);
          break;
        }
        default:
          customValues[def.key] = String(rawVal);
      }
    }

    return { valid: errors.length === 0, enriched: { ...data, customFields: customValues }, errors };
  },
};
