// Onboarding wizard — step-by-step tenant setup tracking
export interface OnboardingStep {
  key: string;
  label: string;
  description: string;
  order: number;
  completed: boolean;
  completedAt?: string;
}

export interface OnboardingProgress {
  tenantId: string;
  steps: OnboardingStep[];
  startedAt: string;
  completedAt?: string;
}

const DEFAULT_STEPS: Omit<OnboardingStep, 'completed' | 'completedAt'>[] = [
  { key: 'create_business', label: 'Create Your Business', description: 'Set up your entertainment business profile', order: 1 },
  { key: 'configure_ledger', label: 'Configure Chart of Accounts', description: 'Set up your financial accounts for revenue tracking', order: 2 },
  { key: 'create_agent', label: 'Create Your First Agent', description: 'Configure an autonomous agent for booking automation', order: 3 },
  { key: 'first_booking', label: 'Make Your First Booking', description: 'Create a test booking to see the platform in action', order: 4 },
  { key: 'invite_team', label: 'Invite Team Members', description: 'Add collaborators to your workspace', order: 5 },
  { key: 'connect_payments', label: 'Connect Payment Processing', description: 'Set up Stripe or payment links for receiving payments', order: 6 },
  { key: 'publish_listing', label: 'Publish a Marketplace Listing', description: 'List your services or IP on the marketplace', order: 7 },
  { key: 'setup_integrations', label: 'Set Up Integrations', description: 'Connect Slack, webhooks, or API keys', order: 8 },
];

const progressMap = new Map<string, OnboardingProgress>();

export const onboarding = {
  getProgress(tenantId: string): OnboardingProgress {
    let p = progressMap.get(tenantId);
    if (!p) {
      p = {
        tenantId,
        steps: DEFAULT_STEPS.map(s => ({ ...s, completed: false })),
        startedAt: new Date().toISOString(),
      };
      progressMap.set(tenantId, p);
    }
    return p;
  },

  completeStep(tenantId: string, stepKey: string): OnboardingProgress {
    const p = this.getProgress(tenantId);
    const step = p.steps.find(s => s.key === stepKey);
    if (!step) throw new Error(`Unknown step: ${stepKey}`);
    step.completed = true;
    step.completedAt = new Date().toISOString();

    if (p.steps.every(s => s.completed)) {
      p.completedAt = new Date().toISOString();
    }
    return p;
  },

  uncompleteStep(tenantId: string, stepKey: string): OnboardingProgress {
    const p = this.getProgress(tenantId);
    const step = p.steps.find(s => s.key === stepKey);
    if (step) { step.completed = false; step.completedAt = undefined; }
    return p;
  },

  getCompletionPct(tenantId: string): number {
    const p = this.getProgress(tenantId);
    const done = p.steps.filter(s => s.completed).length;
    return Math.round(done / p.steps.length * 100);
  },

  getNextStep(tenantId: string): OnboardingStep | null {
    const p = this.getProgress(tenantId);
    return p.steps.find(s => !s.completed) ?? null;
  },

  reset(tenantId: string): void {
    progressMap.delete(tenantId);
  },
};
