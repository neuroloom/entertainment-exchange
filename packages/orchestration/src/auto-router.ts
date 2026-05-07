// AutoRouter — Ngram-embedding task router with FAISS-style index
// Routes tasks to specialized agent subtypes by embedding similarity

import { cosineSimilarity } from './omega-governance.js';
import type { RoutingResult } from './types.js';

interface IndexEntry { subtype: string; vector: number[]; }

export class NgramEmbedder {
  private readonly n: number;
  constructor(n = 3) { this.n = n; }

  embed(text: string): number[] {
    const vec = new Array(256).fill(0);
    const t = text.toLowerCase();
    for (let i = 0; i <= t.length - this.n; i++) {
      const gram = t.slice(i, i + this.n);
      let h = 0;
      for (let j = 0; j < gram.length; j++) { h = ((h << 5) - h + gram.charCodeAt(j)) | 0; }
      vec[Math.abs(h) % 256]++;
    }
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return mag > 0 ? vec.map(v => v / mag) : vec;
  }
}

export class SkillIndex {
  private entries: IndexEntry[] = [];

  constructor(private embedder = new NgramEmbedder(3)) {}

  register(subtype: string, description: string): void {
    this.entries.push({ subtype, vector: this.embedder.embed(description) });
  }

  search(queryVector: number[], k = 3): Array<{ subtype: string; score: number }> {
    return this.entries
      .map(e => ({ subtype: e.subtype, score: cosineSimilarity(e.vector, queryVector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  get size(): number { return this.entries.length; }
}

export class TaskRouter {
  private embedder: NgramEmbedder;
  private index: SkillIndex;

  constructor(embedder?: NgramEmbedder, index?: SkillIndex) {
    this.embedder = embedder ?? new NgramEmbedder(3);
    this.index = index ?? new SkillIndex(this.embedder);
  }

  registerSkill(subtype: string, description: string): void {
    this.index.register(subtype, description);
  }

  route(description: string): RoutingResult {
    const embedding = this.embedder.embed(description);
    const results = this.index.search(embedding, 5);
    return {
      subtype: results[0]?.subtype ?? 'general',
      confidence: results[0]?.score ?? 0,
      alternatives: results.slice(1),
    };
  }
}
