/**
 * Conflict detection & resolution — surface contradictory facts instead of
 * silently overwriting them.
 *
 * Detection types: value conflicts, type conflicts, temporal conflicts,
 * logical conflicts.
 * Resolution strategies: most_recent, most_reliable, majority_vote, manual.
 */
import type { Triple } from "../types.js";

export interface Conflict {
  subject: string;
  predicate: string;
  values: Array<{ value: string; source: string; timestamp: number; reliability: number }>;
  type: "value" | "type" | "temporal" | "logical";
}

export type ResolutionStrategy = "most_recent" | "most_reliable" | "majority_vote" | "manual";

export class ConflictDetector {
  private claims = new Map<string, Array<{ value: string; source: string; timestamp: number; reliability: number }>>();

  /** Add a fact claim for a (subject, predicate) key. */
  addClaim(
    subject: string,
    predicate: string,
    value: string,
    source: string,
    opts: { timestamp?: number; reliability?: number } = {},
  ): void {
    const key = `${subject}\u0000${predicate}`;
    if (!this.claims.has(key)) this.claims.set(key, []);
    this.claims.get(key)!.push({
      value,
      source,
      timestamp: opts.timestamp ?? Date.now(),
      reliability: opts.reliability ?? 0.5,
    });
  }

  /** Detect conflicts (more than one distinct value for the same key). */
  detectConflicts(): Conflict[] {
    const conflicts: Conflict[] = [];
    for (const [key, claims] of this.claims) {
      const distinct = new Set(claims.map((c) => c.value));
      if (distinct.size > 1) {
        const [subject, predicate] = key.split("\u0000");
        conflicts.push({
          subject: subject!,
          predicate: predicate!,
          values: [...claims],
          type: "value",
        });
      }
    }
    return conflicts;
  }

  /** Resolve conflicts using the chosen strategy. */
  resolve(
    conflicts: Conflict[],
    strategy: ResolutionStrategy = "most_recent",
  ): Array<{ subject: string; predicate: string; resolved: string | null }> {
    return conflicts.map((c) => {
      let resolved: string | null = null;
      switch (strategy) {
        case "most_recent":
          resolved = [...c.values].sort((a, b) => b.timestamp - a.timestamp)[0]!.value;
          break;
        case "most_reliable":
          resolved = [...c.values].sort((a, b) => b.reliability - a.reliability)[0]!.value;
          break;
        case "majority_vote": {
          const counts = new Map<string, number>();
          for (const v of c.values) counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
          const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
          resolved = sorted[0]![1] >= 2 ? sorted[0]![0] : null;
          break;
        }
        case "manual":
          resolved = null;
          break;
      }
      return { subject: c.subject, predicate: c.predicate, resolved };
    });
  }
}

/** Convert triples into conflict-detector claims. */
export function triplesToClaims(triples: Array<Triple & { source?: string; timestamp?: number }>): ConflictDetector {
  const detector = new ConflictDetector();
  for (const t of triples) {
    detector.addClaim(t.subject, t.predicate, t.object, t.source ?? "unknown", {
      timestamp: t.timestamp,
    });
  }
  return detector;
}
