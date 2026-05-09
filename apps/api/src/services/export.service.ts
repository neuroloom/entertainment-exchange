// Export service — CSV/JSON serialization with proper escaping and streaming
// Supports exporting data from any in-memory store for compliance and data portability

export type ExportFormat = 'csv' | 'json' | 'jsonl';

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]);
  const header = keys.map(csvEscape).join(',');
  const body = rows.map(row => keys.map(k => csvEscape(row[k])).join(','));
  return [header, ...body].join('\n') + '\n';
}

function toJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

function toJsonl(rows: Record<string, unknown>[]): string {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n';
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  jsonl: 'application/x-ndjson; charset=utf-8',
};

export function serializeRows(rows: Record<string, unknown>[], format: ExportFormat): string {
  switch (format) {
    case 'csv': return toCsv(rows);
    case 'json': return toJson(rows);
    case 'jsonl': return toJsonl(rows);
  }
}

export function getExportContentType(format: ExportFormat): string {
  return CONTENT_TYPES[format];
}

export function getExportFilename(domain: string, format: ExportFormat): string {
  return `${domain}-export-${new Date().toISOString().slice(0, 10)}.${format === 'jsonl' ? 'jsonl' : format}`;
}
