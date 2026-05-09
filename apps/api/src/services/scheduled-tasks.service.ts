// Scheduled tasks — background cleanup and maintenance runner
export interface TaskSchedule {
  name: string;
  intervalMs: number;
  lastRunAt?: string;
  run: () => Promise<{ success: boolean; affected?: number; error?: string }>;
}

const tasks: TaskSchedule[] = [];
let _started = false;

export const scheduler = {
  register(task: TaskSchedule): void {
    tasks.push(task);
  },

  start(): void {
    if (_started) return;
    _started = true;
    for (const task of tasks) {
      void this.runLoop(task);
    }
  },

  async runLoop(task: TaskSchedule): Promise<void> {
    while (true) {
      await new Promise(resolve => setTimeout(resolve, task.intervalMs));
      try {
        task.lastRunAt = new Date().toISOString();
        await task.run();
      } catch {
        // Task failures are non-fatal
      }
    }
  },

  async runNow(name: string): Promise<{ success: boolean; affected?: number; error?: string }> {
    const task = tasks.find(t => t.name === name);
    if (!task) return { success: false, error: `Task not found: ${name}` };
    task.lastRunAt = new Date().toISOString();
    return task.run();
  },

  listTasks(): Array<{ name: string; intervalMs: number; lastRunAt?: string }> {
    return tasks.map(({ name, intervalMs, lastRunAt }) => ({ name, intervalMs, lastRunAt }));
  },
};
