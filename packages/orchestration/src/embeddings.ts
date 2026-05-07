// Embedding Provider — pluggable semantic embedding backends
// Replaces NgramEmbedder with real semantic vectors in SemanticCache
// FNV hash fallback when no provider configured

export interface EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ── OpenAI Embedding Provider ──────────────────────────────────────────────

interface OpenAIEmbeddingConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions: number;
  readonly model: string;
  private apiKey: string;
  private baseURL: string;

  constructor(config: OpenAIEmbeddingConfig = {}) {
    this.model = config.model ?? 'text-embedding-3-small';
    this.dimensions = this.model === 'text-embedding-3-large' ? 3072
      : this.model === 'text-embedding-ada-002' ? 1536
      : 1536;
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    this.baseURL = config.baseURL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) return vectorFallback(text, this.dimensions);
    try {
      const res = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: text, model: this.model }),
      });
      if (!res.ok) return vectorFallback(text, this.dimensions);
      const json = await res.json();
      return json.data?.[0]?.embedding ?? vectorFallback(text, this.dimensions);
    } catch {
      return vectorFallback(text, this.dimensions);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) return texts.map(t => vectorFallback(t, this.dimensions));
    try {
      const res = await fetch(`${this.baseURL}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: texts, model: this.model }),
      });
      if (!res.ok) return texts.map(t => vectorFallback(t, this.dimensions));
      const json = await res.json();
      return json.data?.map((d: any) => d.embedding) ?? texts.map(t => vectorFallback(t, this.dimensions));
    } catch {
      return texts.map(t => vectorFallback(t, this.dimensions));
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

let _provider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (_provider) return _provider;
  const provider = process.env.EMBEDDING_PROVIDER ?? 'openai';
  if (provider === 'openai') {
    _provider = new OpenAIEmbeddingProvider();
  } else {
    _provider = new OpenAIEmbeddingProvider({ model: provider });
  }
  return _provider;
}

export function setEmbeddingProvider(provider: EmbeddingProvider): void {
  _provider = provider;
}

// ── FNV-1a fallback (zero API cost, zero semantic meaning) ─────────────────

function hashFNV(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function vectorFallback(text: string, dimensions: number): number[] {
  const vec = new Array(dimensions).fill(0);
  const seed = hashFNV(text);
  // Seed-based pseudo-random unit vector — deterministic per text, no API cost
  for (let i = 0; i < dimensions; i++) {
    const h = hashFNV(`${text}:${i}:${seed}`);
    vec[i] = (h / 0xFFFFFFFF) * 2 - 1;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return mag > 0 ? vec.map(v => v / mag) : vec;
}
