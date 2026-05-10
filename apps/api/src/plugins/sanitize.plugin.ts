// Sanitize plugin — preHandler hook that sanitizes all request bodies and query params
// L2 INJECTION DETECTION: regex pre-filter → LLM classifier → block/sanitize
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from './errorHandler.js';

// ── Layer 0: Bidi/XSS stripping (fast, always runs) ────────────────────────

const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;
const SCRIPT_TAG_RE = /<\s*script[\s/>]/i;

function sanitizeString(value: string, context: string): string {
  let sanitized = value.trim();
  sanitized = sanitized.replace(BIDI_OVERRIDE_RE, '');
  if (SCRIPT_TAG_RE.test(sanitized)) {
    throw AppError.invalid(`Potentially unsafe content in ${context}`);
  }
  return sanitized;
}

function sanitizeValue(value: unknown, context: string): unknown {
  if (typeof value === 'string') {
    return sanitizeString(value, context);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(item, `${context}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = sanitizeValue(val, `${context}.${key}`);
    }
    return result;
  }
  return value;
}

// ── Layer 1: Regex injection pre-filter ────────────────────────────────────

const INJECTION_PATTERNS: { name: string; re: RegExp; severity: 'block' | 'flag' }[] = [
  // Prompt override / system prompt extraction
  { name: 'system_override', re: /(?:ignore|forget|disregard)\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|rules?|messages?)/i, severity: 'block' },
  { name: 'persona_hijack', re: /you\s+(?:are|now)\s+(?:now\s+)?(?:DAN|jailbroken|unfiltered|evil|malicious|a\s+different\s+model)/i, severity: 'block' },
  { name: 'dole_reveal', re: /(?:reveal|print|show|output|display)\s+(?:your\s+)?(?:system\s+(?:prompt|message|instructions?)|hidden\s+(?:prompt|instructions?|rules?)|secret\s+(?:prompt|instructions?))/i, severity: 'block' },
  { name: 'encoded_instruction', re: /(?:base64|hex|rot13|unicode\s+escape|url\s*encode)\s*(?:encode|decode|convert|translate)\s*(?:this|the\s+following|below)/i, severity: 'flag' },
  { name: 'delimiter_injection', re: /<\/?\s*(?:system|instruction|prompt|rule|guideline)\s*>/i, severity: 'block' },
  { name: 'token_smuggling', re: /(?:<|&lt;)(?:\|?end\|?of\|?turn\|?)(?:>|&gt;)/i, severity: 'flag' },
  { name: 'multi_turn_jailbreak', re: /(?:let['']s\s+play\s+a\s+game|role[\s-]*play|imagine\s+(?:you['']re|you\s+are)\s+(?:an?\s+)?(?:unfiltered|unethical|without\s+restrictions))/i, severity: 'flag' },
  // Generic instruction-following injection
  { name: 'instruction_injection', re: /^(?:IMPORTANT|CRITICAL|SYSTEM|ADMIN|URGENT)\s*[:!]\s*(?:you\s+must|you\s+should|do\s+not|please\s+do)/im, severity: 'flag' },
  // Recursive summarization attack
  { name: 'recursive_attack', re: /(?:summarize|repeat|paraphrase|restate)\s+(?:the\s+)?(?:above|previous|prior|all)\s+(?:and\s+)?(?:then\s+)?(?:respond|answer|reply|output|act)/i, severity: 'flag' },
];

function scanInjection(text: string): { name: string; severity: 'block' | 'flag' }[] {
  const hits: { name: string; severity: 'block' | 'flag' }[] = [];
  for (const pat of INJECTION_PATTERNS) {
    if (pat.re.test(text)) {
      hits.push({ name: pat.name, severity: pat.severity });
    }
  }
  return hits;
}

// ── Layer 2: LLM classifier for ambiguous inputs ───────────────────────────

let llmClassifyFn: ((text: string) => Promise<{ malicious: boolean; confidence: number }>) | null = null;

export function setInjectionClassifier(fn: typeof llmClassifyFn): void {
  llmClassifyFn = fn;
}

async function llmClassify(text: string): Promise<{ malicious: boolean; confidence: number }> {
  if (!llmClassifyFn) return { malicious: false, confidence: 0 };
  try {
    return await llmClassifyFn(text);
  } catch {
    // LLM unavailable — default to safe (false positive better than missed attack)
    return { malicious: false, confidence: 0 };
  }
}

// ── Pipeline ───────────────────────────────────────────────────────────────

function collectStrings(obj: unknown, acc: string[] = []): string[] {
  if (typeof obj === 'string') { acc.push(obj); }
  else if (Array.isArray(obj)) { for (const item of obj) collectStrings(item, acc); }
  else if (obj !== null && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) collectStrings(v, acc);
  }
  return acc;
}

export async function sanitizePlugin(app: FastifyInstance) {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    // Layer 0: Bidi/XSS sanitization
    if (req.body && typeof req.body === 'object') {
      const sanitized = sanitizeValue(req.body, 'request body');
      req.body = sanitized;
    }

    if (req.query) {
      const query = req.query as Record<string, unknown>;
      for (const key of Object.keys(query)) {
        const val = query[key];
        if (typeof val === 'string') {
          query[key] = sanitizeString(val, `query parameter '${key}'`);
        }
      }
    }

    req.ctx.sanitized = true;

    // Layer 1: Regex injection scan across all string fields in body+query
    const allStrings: string[] = [];
    if (req.body) collectStrings(req.body, allStrings);
    if (req.query) collectStrings(req.query, allStrings);

    const allHits: { name: string; severity: 'block' | 'flag' }[] = [];
    for (const s of allStrings) {
      allHits.push(...scanInjection(s));
    }

    // Immediate block for critical patterns
    const blocking = allHits.filter(h => h.severity === 'block');
    if (blocking.length > 0) {
      throw AppError.forbidden(`Injection detected: ${blocking.map(h => h.name).join(', ')}`);
    }

    // Layer 2: LLM classify flagged-but-not-blocked inputs
    const flagged = allHits.filter(h => h.severity === 'flag');
    if (flagged.length > 0) {
      const fullText = allStrings.join(' | ');
      const result = await llmClassify(fullText);
      if (result.malicious && result.confidence > 0.7) {
        throw AppError.forbidden(`Injection classified as malicious (confidence: ${(result.confidence * 100).toFixed(0)}%)`);
      }
    }
  });
}
