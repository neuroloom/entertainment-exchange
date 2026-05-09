// Contract template service — legal agreement generation with variable substitution
import { v4 as uuid } from 'uuid';

export interface ContractTemplate {
  id: string;
  tenantId: string;
  name: string;
  type: 'performance' | 'service' | 'license' | 'nda' | 'custom';
  template: string;        // Markdown with {{variable}} placeholders
  requiredVars: string[];  // Variables that must be provided
  createdAt: string;
}

export interface GeneratedContract {
  id: string;
  templateId: string;
  tenantId: string;
  bookingId?: string;
  dealId?: string;
  content: string;
  vars: Record<string, string>;
  createdAt: string;
}

const templates: ContractTemplate[] = [];
const generated: GeneratedContract[] = [];

// Built-in templates
const BUILT_IN: Omit<ContractTemplate, 'id' | 'tenantId' | 'createdAt'>[] = [
  {
    name: 'Performance Agreement',
    type: 'performance',
    template: `# Performance Agreement

**Between:** {{artistName}} ("Artist") and {{venueName}} ("Venue")

**Date:** {{eventDate}} | **Time:** {{startTime}} – {{endTime}}

## 1. Services
Artist agrees to perform at Venue on the date and time specified above. The performance shall be approximately {{durationHours}} hours in duration.

## 2. Compensation
Total fee: \${{totalAmount}} ({{currency}}). Deposit of \${{depositAmount}} due upon signing.

## 3. Cancellation
Either party may cancel with {{cancellationNoticeDays}} days written notice. In event of cancellation by Venue within this period, full fee remains payable.

## 4. Technical Requirements
{{technicalRequirements}}

## 5. Governing Law
This agreement is governed by the laws of {{jurisdiction}}.

**Signed:** _________________________ (Artist)  _________________________ (Venue)
**Date:** {{signingDate}}`,
    requiredVars: ['artistName', 'venueName', 'eventDate', 'startTime', 'endTime', 'durationHours', 'totalAmount'],
  },
  {
    name: 'Service Agreement',
    type: 'service',
    template: `# Service Agreement

**Client:** {{clientName}} | **Provider:** {{providerName}}

## Scope of Work
{{scopeOfWork}}

## Compensation
Total: \${{totalAmount}} ({{currency}}). Payment terms: {{paymentTerms}}.

## Term
{{startDate}} to {{endDate}}.

**Signed:** _________________________  **Date:** {{signingDate}}`,
    requiredVars: ['clientName', 'providerName', 'scopeOfWork', 'totalAmount'],
  },
];

function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export const contractTemplates = {
  init(tenantId: string): void {
    for (const bt of BUILT_IN) {
      if (!templates.find(t => t.tenantId === tenantId && t.type === bt.type)) {
        templates.push({ ...bt, id: uuid(), tenantId, createdAt: new Date().toISOString() });
      }
    }
  },

  list(tenantId: string): ContractTemplate[] {
    return templates.filter(t => t.tenantId === tenantId);
  },

  get(id: string, tenantId: string): ContractTemplate | undefined {
    return templates.find(t => t.id === id && t.tenantId === tenantId);
  },

  generate(opts: {
    templateId: string;
    tenantId: string;
    bookingId?: string;
    dealId?: string;
    vars: Record<string, string>;
  }): GeneratedContract {
    const tmpl = this.get(opts.templateId, opts.tenantId);
    if (!tmpl) throw new Error('Contract template not found');

    const missing = tmpl.requiredVars.filter(v => !opts.vars[v]);
    if (missing.length > 0) throw new Error(`Missing required variables: ${missing.join(', ')}`);

    const content = renderTemplate(tmpl.template, opts.vars);
    const gc: GeneratedContract = {
      id: uuid(), templateId: opts.templateId, tenantId: opts.tenantId,
      bookingId: opts.bookingId, dealId: opts.dealId,
      content, vars: opts.vars, createdAt: new Date().toISOString(),
    };
    generated.push(gc);
    return gc;
  },

  getGenerated(id: string, tenantId: string): GeneratedContract | undefined {
    return generated.find(g => g.id === id && g.tenantId === tenantId);
  },

  listGenerated(tenantId: string): GeneratedContract[] {
    return generated.filter(g => g.tenantId === tenantId);
  },
};
