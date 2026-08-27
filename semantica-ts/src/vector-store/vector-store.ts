/**
 * Vector store — in-memory vector database with semantic and hybrid search.
 *
 * Mirrors `semantica.vector_store.VectorStore` with cosine similarity top-k
 * retrieval and hybrid (vector + keyword) fusion via reciprocal-rank fusion.
 */
import { cosineSimilarity, tokenize } from "../utils.js";

export interface VectorRecord {
  id: string;
  vector: number[];
  text?: string;
  metadata?: Record<string, unknown>;
}

export class VectorStore {
  private records = new Map<string, VectorRecord>();

  constructor(public dimension: number) {}

  /** Add a single document/vector. */
  add(id: string, vector: number[], text?: string, metadata?: Record<string, unknown>): void {
    if (vector.length !== this.dimension) {
      throw new Error(`Vector dimension ${vector.length} != ${this.dimension}`);
    }
    this.records.set(id, { id, vector, text, metadata });
  }

  addDocuments(texts: string[], embed: (t: string) => number[]): void {
    texts.forEach((text, i) => {
      this.add(`doc_${i}`, embed(text), text);
    });
  }

  /** Semantic top-k search by vector similarity. */
  search(
    queryVector: number[],
    topK = 10,
    filter?: (metadata: Record<string, unknown>) => boolean,
  ): Array<{ id: string; score: number; text?: string; metadata?: Record<string, unknown> }> {
    const scored: Array<{ id: string; score: number; text?: string; metadata?: Record<string, unknown> }> = [];
    for (const rec of this.records.values()) {
      if (filter && rec.metadata && !filter(rec.metadata)) continue;
      scored.push({
        id: rec.id,
        score: cosineSimilarity(queryVector, rec.vector),
        text: rec.text,
        metadata: rec.metadata,
      });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** Keyword (BM25-like simple term overlap) search. */
  keywordSearch(query: string, topK = 10): Array<{ id: string; score: number; text?: string }> {
    const terms = new Set(tokenize(query));
    const scored: Array<{ id: string; score: number; text?: string }> = [];
    for (const rec of this.records.values()) {
      if (!rec.text) continue;
      const docTerms = tokenize(rec.text);
      let overlap = 0;
      for (const t of docTerms) if (terms.has(t)) overlap++;
      const score = terms.size ? overlap / terms.size : 0;
      if (score > 0) scored.push({ id: rec.id, score, text: rec.text });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /** Hybrid search: reciprocal-rank fusion of vector + keyword results. */
  hybridSearch(
    query: string,
    queryVector: number[],
    topK = 10,
  ): Array<{ id: string; score: number; text?: string }> {
    const vectorResults = this.search(queryVector, this.records.size);
    const keywordResults = this.keywordSearch(query, this.records.size);
    const rrf: Record<string, number> = {};
    const rank = (results: Array<{ id: string }>, weight: number) => {
      results.forEach((r, i) => {
        rrf[r.id] = (rrf[r.id] ?? 0) + weight / (60 + i + 1);
      });
    };
    rank(vectorResults, 1);
    rank(keywordResults, 1);
    return Object.entries(rrf)
      .map(([id, score]) => {
        const rec = this.records.get(id);
        return { id, score, text: rec?.text };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number {
    return this.records.size;
  }
}
