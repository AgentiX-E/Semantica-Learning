# semantica-ts

**Graph-Native Infrastructure for Context and Accountable AI Systems** — a
TypeScript reimplementation of
[Semantica](https://github.com/semantica-agi/semantica) (formerly
BuildSemantica), built from scratch to teach the underlying concepts while
replicating the full capability surface.

> This package is the reference implementation for the
> **Semantica-Learning** interactive course. Every module maps 1:1 to a
> capability in the original Python project.

## What it implements

| Semantica capability | semantica-ts module |
| --- | --- |
| Context Graph (nodes, edges, BFS, temporal) | `src/graph/context-graph.ts` |
| Decision Intelligence (record, causal chains, precedents, policy) | `src/decisions/decision-engine.ts` |
| Reasoning (forward chaining, Rete, Datalog, SPARQL, deductive/abductive) | `src/reasoning/index.ts` |
| Provenance (W3C PROV-O) | `src/provenance/provenance-manager.ts` |
| Graph analytics (centrality, community, paths, link prediction) | `src/analytics/index.ts` |
| Deduplication & entity resolution | `src/deduplication/entity-resolver.ts` |
| Conflict detection & resolution | `src/conflicts/conflict-detector.ts` |
| Ontology (SHACL / OWL / SKOS) | `src/ontology/ontology.ts` |
| Vector store (semantic + hybrid search) | `src/vector-store/vector-store.ts` |
| Temporal intelligence (bi-temporal, Allen algebra) | `src/temporal/temporal-query.ts` |
| Export (RDF Turtle, JSON-LD, N-Triples, CSV, Cypher) | `src/export/exporters.ts` |

## Quick start

```bash
npm install
npm run typecheck   # strict TypeScript
npm test            # 98 tests
npm run coverage    # ≥95% lines / statements / functions, ≥80% branches
```

```typescript
import { ContextGraph } from "semantica-ts";

const graph = new ContextGraph();
graph.addNode("acme_corp", "Organization", "Acme Corp");
graph.addNode("alice", "Person", "Alice Chen", { role: "CTO" });
graph.addEdge("alice", "acme_corp", "works_for");

const decisionId = graph.decisions.recordDecision({
  category: "vendor_selection",
  scenario: "Choose cloud provider",
  reasoning: "AWS offers BAA and mature HIPAA tooling",
  outcome: "selected_aws",
  confidence: 0.93,
});

const chain = graph.decisions.traceCausalChain(decisionId);
```

## License

MIT
