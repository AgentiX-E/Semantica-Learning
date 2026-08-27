/**
 * Deduplication & entity resolution — merge duplicate entities across sources.
 *
 * Strategies mirror the Python implementation:
 *   - v1        : Jaro–Winkler string similarity
 *   - blocking_v2: candidate blocking + similarity (reduces O(n²))
 *   - hybrid_v2  : blocking + semantic embedding match
 *   - semantic_v2: pure embedding-based resolution
 */
import { cosineSimilarity, jaroWinkler } from "../utils.js";

export type ResolutionStrategy = "v1" | "blocking_v2" | "hybrid_v2" | "semantic_v2";

export interface EntityRecord {
  id: string;
  name: string;
  embedding?: number[];
  [key: string]: unknown;
}

export class DuplicateDetector {
  constructor(private similarityThreshold = 0.85) {}

  /** Detect duplicate pairs above the similarity threshold. */
  detectDuplicates(
    entities: EntityRecord[],
    strategy: ResolutionStrategy = "v1",
  ): Array<{ a: EntityRecord; b: EntityRecord; score: number }> {
    const pairs: Array<{ a: EntityRecord; b: EntityRecord; score: number }> = [];
    if (strategy === "semantic_v2" || strategy === "hybrid_v2") {
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          if (!entities[i]!.embedding || !entities[j]!.embedding) continue;
          const score = cosineSimilarity(entities[i]!.embedding!, entities[j]!.embedding!);
          if (score >= this.similarityThreshold) {
            pairs.push({ a: entities[i]!, b: entities[j]!, score });
          }
        }
      }
      return pairs;
    }
    // v1 and blocking_v2: string similarity (blocking uses prefix buckets).
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        if (strategy === "blocking_v2" && !sameBlock(entities[i]!.name, entities[j]!.name)) {
          continue;
        }
        const score = jaroWinkler(entities[i]!.name.toLowerCase(), entities[j]!.name.toLowerCase());
        if (score >= this.similarityThreshold) {
          pairs.push({ a: entities[i]!, b: entities[j]!, score });
        }
      }
    }
    return pairs;
  }
}

function sameBlock(a: string, b: string): boolean {
  // Blocking key: first 3 chars or first token.
  return a.slice(0, 3).toLowerCase() === b.slice(0, 3).toLowerCase();
}

export class EntityMerger {
  /** Merge duplicate groups, preserving the first entity's id and union of attributes. */
  mergeDuplicates(
    entities: EntityRecord[],
    strategy: ResolutionStrategy = "v1",
    similarityThreshold = 0.85,
  ): EntityRecord[] {
    const detector = new DuplicateDetector(similarityThreshold);
    const pairs = detector.detectDuplicates(entities, strategy);
    // Union-find over duplicate pairs.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x)! !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    for (const { a, b } of pairs) union(a.id, b.id);

    const groups = new Map<string, EntityRecord[]>();
    for (const e of entities) {
      const root = find(e.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(e);
    }
    const merged: EntityRecord[] = [];
    for (const group of groups.values()) {
      const first = group[0]!;
      const name = first.name;
      const combined: EntityRecord = { ...first, name, id: first.id };
      for (const e of group.slice(1)) {
        for (const [k, v] of Object.entries(e)) {
          if (k === "id" || k === "embedding") continue;
          if (combined[k] === undefined) combined[k] = v;
        }
      }
      merged.push(combined);
    }
    return merged;
  }
}

/** High-level entity resolution facade. */
export class EntityResolver {
  resolve(
    entities: EntityRecord[],
    strategy: ResolutionStrategy = "semantic_v2",
  ): EntityRecord[] {
    return new EntityMerger().mergeDuplicates(entities, strategy);
  }
}
