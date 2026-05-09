// Batch job tracker — progress tracking for long-running operations
export interface BatchJob {
  id: string;
  tenantId: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: { completed: number; total: number; pct: number };
  errors: Array<{ item: number; error: string }>;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

const jobs: BatchJob[] = [];
const MAX_JOBS = 5000;

export const batchJobTracker = {
  create(tenantId: string, type: string, total: number): BatchJob {
    const job: BatchJob = {
      id: crypto.randomUUID(), tenantId, type, status: 'queued',
      progress: { completed: 0, total, pct: 0 }, errors: [],
      createdAt: new Date().toISOString(),
    };
    jobs.push(job);
    if (jobs.length > MAX_JOBS) jobs.splice(0, jobs.length - MAX_JOBS);
    return job;
  },

  start(id: string): BatchJob | null {
    const j = jobs.find(jj => jj.id === id && jj.status === 'queued');
    if (!j) return null;
    j.status = 'running';
    j.startedAt = new Date().toISOString();
    return j;
  },

  progress(id: string, completed: number, error?: { item: number; error: string }): BatchJob | null {
    const j = jobs.find(jj => jj.id === id && jj.status === 'running');
    if (!j) return null;
    j.progress.completed = completed;
    j.progress.pct = j.progress.total > 0 ? Math.round(completed / j.progress.total * 100) : 0;
    if (error) j.errors.push(error);
    return j;
  },

  complete(id: string): BatchJob | null {
    const j = jobs.find(jj => jj.id === id && jj.status === 'running');
    if (!j) return null;
    j.status = 'completed';
    j.completedAt = new Date().toISOString();
    j.progress.completed = j.progress.total;
    j.progress.pct = 100;
    return j;
  },

  fail(id: string, error: string): BatchJob | null {
    const j = jobs.find(jj => jj.id === id);
    if (!j) return null;
    j.status = 'failed';
    j.completedAt = new Date().toISOString();
    j.errors.push({ item: -1, error });
    return j;
  },

  get(id: string, tenantId: string): BatchJob | undefined {
    return jobs.find(j => j.id === id && j.tenantId === tenantId);
  },

  list(tenantId: string): BatchJob[] {
    return jobs.filter(j => j.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
