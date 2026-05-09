// Migration status — track applied database migrations
export interface MigrationRecord {
  name: string;
  version: number;
  appliedAt: string;
  status: 'applied' | 'failed' | 'pending';
  checksum: string;
  durationMs?: number;
  error?: string;
}

const records: MigrationRecord[] = [];

export const migrationStatus = {
  recordApplied(name: string, version: number, checksum: string, durationMs: number): void {
    records.push({ name, version, appliedAt: new Date().toISOString(), status: 'applied', checksum, durationMs });
  },

  recordFailed(name: string, version: number, error: string, durationMs: number): void {
    records.push({ name, version, appliedAt: new Date().toISOString(), status: 'failed', checksum: '', durationMs, error });
  },

  list(): MigrationRecord[] {
    return [...records].sort((a, b) => b.version - a.version);
  },

  getLatest(): MigrationRecord | undefined {
    if (records.length === 0) return undefined;
    return records.reduce((latest, r) => r.version > latest.version ? r : latest);
  },

  getCurrentVersion(): number {
    const applied = records.filter(r => r.status === 'applied');
    return applied.length > 0 ? Math.max(...applied.map(r => r.version)) : 0;
  },

  getPending(knownMigrations: Array<{ name: string; version: number }>): Array<{ name: string; version: number }> {
    const appliedSet = new Set(records.filter(r => r.status === 'applied').map(r => r.name));
    return knownMigrations.filter(m => !appliedSet.has(m.name));
  },

  getStatus(): { total: number; applied: number; failed: number; currentVersion: number; lastAppliedAt?: string } {
    const applied = records.filter(r => r.status === 'applied');
    return {
      total: records.length, applied: applied.length,
      failed: records.filter(r => r.status === 'failed').length,
      currentVersion: this.getCurrentVersion(),
      lastAppliedAt: applied.length > 0 ? applied[applied.length - 1].appliedAt : undefined,
    };
  },
};
