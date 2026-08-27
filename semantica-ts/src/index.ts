/**
 * semantica-ts — public API surface.
 *
 * Graph-Native Infrastructure for Context and Accountable AI Systems.
 * A TypeScript reimplementation of Semantica (BuildSemantica / semantica-agi).
 */

export * from "./types.js";
export * from "./utils.js";

// Core graph
export { ContextGraph } from "./graph/context-graph.js";
export type {
  ContextGraphConfig,
  NeighborEntry,
} from "./graph/context-graph.js";

// Decision intelligence
export {
  DecisionEngine,
  normalizeCausalType,
} from "./decisions/decision-engine.js";
export type {
  DecisionRule,
  DecisionInsights,
  RecordDecisionInput,
} from "./decisions/decision-engine.js";

// Reasoning
export {
  Reasoner,
  ReteEngine,
  DatalogReasoner,
  SparqlReasoner,
  GraphReasoner,
  createRule,
  tripleString,
} from "./reasoning/index.js";
export type { DatalogFact, DatalogRule } from "./reasoning/index.js";

// Provenance
export { ProvenanceManager } from "./provenance/provenance-manager.js";

// Deduplication / entity resolution
export {
  DuplicateDetector,
  EntityMerger,
  EntityResolver,
} from "./deduplication/entity-resolver.js";
export type { EntityRecord, ResolutionStrategy } from "./deduplication/entity-resolver.js";

// Conflicts
export {
  ConflictDetector,
  triplesToClaims,
} from "./conflicts/conflict-detector.js";
export type { Conflict, ResolutionStrategy as ConflictResolutionStrategy } from "./conflicts/conflict-detector.js";

// Ontology
export {
  OntologyGenerator,
  SHACLGenerator,
  OWLGenerator,
  SKOSVocabulary,
} from "./ontology/ontology.js";
export type { OntologySpec, SHACLShape } from "./ontology/ontology.js";

// Vector store
export { VectorStore } from "./vector-store/vector-store.js";
export type { VectorRecord } from "./vector-store/vector-store.js";

// Temporal
export { TemporalGraphQuery } from "./temporal/temporal-query.js";
export type { BiTemporalFact } from "./temporal/temporal-query.js";

// Analytics
export {
  buildAdjacency,
  computeCentrality,
  detectCommunities,
  dijkstraShortestPath,
  modularity,
  commonNeighbors,
  nodeSimilarity,
} from "./analytics/index.js";
export type { Adjacency, CentralityKind, CentralityResult } from "./analytics/index.js";

// Export
export {
  RDFExporter,
  CSVExporter,
  CypherExporter,
} from "./export/exporters.js";
