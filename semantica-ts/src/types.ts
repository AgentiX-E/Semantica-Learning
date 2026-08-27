/**
 * semantica-ts — Core type definitions.
 *
 * These types mirror the canonical data model of the Python `semantica`
 * project (BuildSemantica / semantica-agi) so that a port from Python to
 * TypeScript is mechanical and 1:1 where the type systems allow it.
 *
 * All timestamps are stored as epoch milliseconds (number) internally and
 * serialized to ISO-8601 strings when persisted. Temporal validity bounds
 * (`validFrom` / `validUntil`) are ISO-8601 strings.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Properties = Record<string, any>;

/** A node in the context / knowledge graph. */
export interface GraphNode {
  /** Unique node id. */
  id: string;
  /** Node type (e.g. `Person`, `Organization`, `decision`, `concept`). */
  type: string;
  /** Human-readable label / body content. */
  content: string;
  /** Arbitrary typed properties. */
  properties: Properties;
  /** Metadata merged into properties at serialization time. */
  metadata: Properties;
  /** Temporal validity lower bound (ISO-8601). */
  validFrom?: string | null;
  /** Temporal validity upper bound (ISO-8601). */
  validUntil?: string | null;
}

/** A directed, typed edge between two nodes. */
export interface GraphEdge {
  /** Stable edge id. */
  id: string;
  /** Family id — edges sharing a family are a logical "same edge" group. */
  familyId: string;
  source_id: string;
  target_id: string;
  /** Edge type / relationship predicate. */
  type: string;
  weight: number;
  properties: Properties;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** The canonical serialized graph shape. */
export interface GraphData {
  graph_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  links?: CrossGraphLink[];
}

export interface CrossGraphLink {
  link_id: string;
  source_node_id: string;
  target_node_id: string;
  other_graph_id: string;
}

/** A recorded agent decision — a first-class object in semantica. */
export interface Decision {
  id: string;
  category: string;
  scenario: string;
  reasoning: string;
  outcome: string;
  confidence: number;
  entities: string[];
  decision_maker: string | null;
  /** Epoch milliseconds. */
  timestamp: number;
  /** ISO-8601 UTC timestamp. */
  recorded_at: string;
  metadata: Properties;
  validFrom?: string | null;
  validUntil?: string | null;
}

/** A single (subject, predicate, object) triple — the atomic unit of knowledge. */
export interface Triple {
  subject: string;
  predicate: string;
  object: string;
}

/** A triple pattern with variables (variables start with `?`). */
export interface TriplePattern {
  subject: string;
  predicate: string;
  object: string;
}

export type RuleType =
  | "implication"
  | "equivalence"
  | "constraint"
  | "transformation";

/** An inference rule used by the reasoners. */
export interface Rule {
  id: string;
  name: string;
  conditions: TriplePattern[];
  conclusion: TriplePattern;
  ruleType: RuleType;
  confidence: number;
  priority: number;
}

/** A fact in working memory. */
export interface Fact {
  id: string;
  predicate: string;
  arguments: string[];
  metadata?: Properties;
}

/** The result of one inference step — carries its explanation path. */
export interface InferenceResult {
  conclusion: string;
  ruleUsed?: Rule | null;
  premises: string[];
  confidence: number;
}

/** Provenance record for a fact / entity. */
export interface ProvenanceRecord {
  entity: string;
  source: string;
  location?: string | null;
  timestamp: string;
  method?: string;
  confidence?: number;
  checksum?: string;
}

/** Causal relationship type (canonical spellings). */
export type CausalRelationshipType = "CAUSED" | "INFLUENCED" | "PRECEDENT_FOR";

/** The three canonical causal edge types. */
export const CAUSAL_EDGE_TYPES: readonly CausalRelationshipType[] = [
  "CAUSED",
  "INFLUENCED",
  "PRECEDENT_FOR",
] as const;

/** Alias map from present-tense / alternate spellings to canonical types. */
export const CAUSAL_EDGE_ALIASES: Record<string, CausalRelationshipType> = {
  CAUSES: "CAUSED",
  CAUSED: "CAUSED",
  INFLUENCES: "INFLUENCED",
  INFLUENCED: "INFLUENCED",
  PRECEDES: "PRECEDENT_FOR",
  PRECEDENT_FOR: "PRECEDENT_FOR",
};

/** All edge types traversed as causal during chain analysis. */
export const CAUSAL_TRAVERSAL_TYPES: ReadonlySet<string> = new Set([
  ...Object.keys(CAUSAL_EDGE_ALIASES),
  "LEADS_TO",
  "LEAD_TO",
  "SUPPORTS",
  "SUPPORT",
]);
