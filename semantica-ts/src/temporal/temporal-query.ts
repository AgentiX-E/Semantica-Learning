/**
 * Temporal intelligence — bi-temporal facts and point-in-time queries.
 */
import type { GraphEdge, GraphNode } from "../types.js";
import { isActive, parseIsoDate } from "../utils.js";

/** A bi-temporal fact: valid time (world) + transaction time (system). */
export interface BiTemporalFact {
  subject: string;
  predicate: string;
  object: string;
  /** When the fact was true in the world (ISO-8601). */
  validFrom?: string | null;
  validUntil?: string | null;
  /** When the fact was recorded in the system (ISO-8601). */
  recordedAt?: string | null;
}

export class TemporalGraphQuery {
  /** Query the graph as it existed at a specific point in time. */
  queryAtTime(
    nodes: GraphNode[],
    edges: GraphEdge[],
    atTime: string | Date,
  ): { nodes: GraphNode[]; edges: GraphEdge[]; num_nodes: number; num_edges: number } {
    const at = atTime instanceof Date ? atTime : new Date(atTime);
    const activeNodes = nodes.filter((n) => isActive(n.validFrom, n.validUntil, at));
    const activeEdges = edges.filter((e) => isActive(e.validFrom, e.validUntil, at));
    return {
      nodes: activeNodes,
      edges: activeEdges,
      num_nodes: activeNodes.length,
      num_edges: activeEdges.length,
    };
  }

  /** Compute the Allen interval algebra relation between two intervals. */
  allenRelation(
    a: { start: string | Date; end: string | Date },
    b: { start: string | Date; end: string | Date },
  ): string {
    const as = toMs(a.start);
    const ae = toMs(a.end);
    const bs = toMs(b.start);
    const be = toMs(b.end);
    if (ae < bs) return "before";
    if (as > be) return "after";
    if (as === bs && ae === be) return "equals";
    if (ae === bs) return "meets";
    if (as === be) return "met_by";
    if (as < bs && ae > bs && ae < be) return "overlaps";
    if (bs < as && be > as && be < ae) return "overlapped_by";
    if (as > bs && ae < be) return "during";
    if (bs > as && be < ae) return "contains";
    if (as === bs && ae < be) return "starts";
    if (as === bs && ae > be) return "started_by";
    if (as > bs && ae === be) return "finishes";
    if (as < bs && ae === be) return "finished_by";
    return "unknown";
  }
}

function toMs(v: string | Date): number {
  if (v instanceof Date) return v.getTime();
  return parseIsoDate(v)?.getTime() ?? NaN;
}
