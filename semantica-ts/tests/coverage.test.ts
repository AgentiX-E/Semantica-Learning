import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContextGraph,
  DecisionEngine,
  Reasoner,
  ReteEngine,
  SparqlReasoner,
  GraphReasoner,
  ProvenanceManager,
  DuplicateDetector,
  EntityMerger,
  ConflictDetector,
  triplesToClaims,
  VectorStore,
  TemporalGraphQuery,
  RDFExporter,
  CSVExporter,
  CypherExporter,
  uuidFor,
  sha256,
  parseIsoDate,
  normalizeTemporalInput,
  isActive,
  closingValidUntil,
  coerceFloat,
  pickFirst,
  jaro,
  jaroWinkler,
  cosineSimilarity,
  tokenize,
  classifyPathDistance,
  computeCentrality,
  detectCommunities,
  modularity,
  commonNeighbors,
  nodeSimilarity,
  buildAdjacency,
} from "../src/index.js";

describe("utils — full coverage", () => {
  it("uuidFor and sha256 produce deterministic ids", () => {
    expect(uuidFor("x")).toBe(uuidFor("x"));
    expect(uuidFor("x")).not.toBe(uuidFor("y"));
    expect(sha256("a")).toHaveLength(64);
  });

  it("parseIsoDate handles year-only and malformed input", () => {
    expect(parseIsoDate("1990")?.getUTCFullYear()).toBe(1990);
    expect(parseIsoDate("not-a-date")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });

  it("normalizeTemporalInput handles Date, number, invalid string", () => {
    expect(normalizeTemporalInput(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(normalizeTemporalInput(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(() => normalizeTemporalInput("bad")).toThrow(/not a valid ISO/);
    expect(normalizeTemporalInput(null)).toBeNull();
  });

  it("isActive handles all bound combinations", () => {
    expect(isActive(null, null)).toBe(true);
    expect(isActive("2020-01-01", null, new Date("2021-01-01"))).toBe(true);
    expect(isActive(null, "2020-01-01", new Date("2021-01-01"))).toBe(false);
    expect(isActive("2022-01-01", null, new Date("2021-01-01"))).toBe(false);
  });

  it("closingValidUntil never widens a window", () => {
    expect(closingValidUntil(null, "2020-01-01")).toBe("2020-01-01");
    expect(closingValidUntil("2023-01-01", "2020-01-01")).toBe("2020-01-01");
    expect(closingValidUntil("2019-01-01", "2020-01-01")).toBe("2019-01-01");
  });

  it("coerceFloat and pickFirst", () => {
    expect(coerceFloat("x", 5)).toBe(5);
    expect(coerceFloat(3.5)).toBe(3.5);
    expect(pickFirst(null, undefined, "", "a")).toBe("a");
    expect(pickFirst(null, undefined)).toBeNull();
  });

  it("jaro and jaroWinkler edge cases", () => {
    expect(jaro("", "")).toBe(1);
    expect(jaro("a", "")).toBe(0);
    expect(jaro("abc", "def")).toBe(0);
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.9);
  });

  it("cosineSimilarity errors and zero vectors", () => {
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(/dimension/);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("tokenize and classifyPathDistance", () => {
    expect(tokenize("Hello, WORLD 123")).toEqual(["hello", "world", "123"]);
    expect(classifyPathDistance(1)).toBe("near");
    expect(classifyPathDistance(2)).toBe("mid");
    expect(classifyPathDistance(5)).toBe("far");
  });
});

describe("ContextGraph — additional coverage", () => {
  it("getNodeProperty default and getNodeAttributes", () => {
    const g = new ContextGraph();
    expect(g.getNodeProperty("missing", "k", "dflt")).toBe("dflt");
    g.addNode("a", "e", "content", { score: 5 });
    expect(g.getNodeAttributes("a")).toEqual({ score: 5 });
    expect(g.getNodeAttributes("missing")).toEqual({});
  });

  it("addNodeAttribute on plain and decision nodes", () => {
    const g = new ContextGraph();
    g.addNode("a", "e", "content");
    g.addNodeAttribute("a", { newKey: 1 });
    expect(g.getNodeProperty("a", "newKey")).toBe(1);
    g.addNodeAttribute("missing", { x: 1 }); // no-op

    const id = g.decisions.recordDecision({
      category: "c", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.5,
    });
    g.addNodeAttribute(id, { extra: true });
    expect(g.getNodeProperty(id, "extra")).toBe(true);
  });

  it("getEdgeData found and not found", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel", 2.0, { note: "x" });
    const data = g.getEdgeData("a", "b");
    expect(data.type).toBe("rel");
    expect(data.weight).toBe(2);
    expect(g.getEdgeData("a", "c")).toEqual({});
  });

  it("getNeighborIds with filter", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel");
    expect(g.getNeighborIds("a", ["rel"])).toEqual(["b"]);
    expect(g.getNeighborIds("a", ["other"])).toEqual([]);
    expect(g.getNeighborIds("missing")).toEqual([]);
  });

  it("getNeighborDistances sorted and filtered", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "b", "rel", 1.0);
    g.addEdge("b", "c", "rel", 1.0);
    const d = g.getNeighborDistances("a", 2);
    expect(d.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("retractNode and removeNode", () => {
    const g = new ContextGraph();
    g.addNode("a", "e", "content");
    g.retractNode("a", "2020-01-01");
    expect(g.getNode("a")?.validUntil).toBe("2020-01-01");
    g.retractNode("missing", "2020-01-01");
    expect(g.removeNode("a")).toBe(true);
    expect(g.removeNode("a")).toBe(false);
    expect(g.hasNode("a")).toBe(false);
  });

  it("findShortestPath returns null when unreachable", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    expect(g.findShortestPath("a", "b")).toBeNull();
    expect(g.findShortestPath("missing", "b")).toBeNull();
  });

  it("linkPredictionScore and findSimilarNodes", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "c", "rel");
    g.addEdge("b", "c", "rel");
    expect(g.linkPredictionScore("a", "b")).toBe(1);

    expect(g.findSimilarNodes("a", new Map())).toEqual([]);
    const embeddings = new Map<string, number[]>([
      ["a", [1, 0]],
      ["b", [0.9, 0.1]],
    ]);
    const similar = g.findSimilarNodes("a", embeddings);
    expect(similar[0]?.id).toBe("b");
  });

  it("saveToFile and loadFromFile round-trip", () => {
    const g = new ContextGraph();
    g.addNode("a", "Person", "Alice");
    g.addEdge("a", "b", "rel"); // dangling target creates auto-node on load only via addEdges
    const dir = mkdtempSync(join(tmpdir(), "semantica-"));
    const file = join(dir, "graph.json");
    g.saveToFile(file);
    const g2 = new ContextGraph();
    g2.loadFromFile(file);
    expect(g2.hasNode("a")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("loadData handles entities/relationships keys and edge list", () => {
    const g = new ContextGraph();
    g.loadData({ entities: [{ id: "a", type: "X" }], relationships: [{ source: "a", target: "b", type: "r" }] });
    expect(g.hasNode("a")).toBe(true);
    expect(g.edges).toHaveLength(1);
  });

  it("addNodes/edges skip invalid entries", () => {
    const g = new ContextGraph();
    expect(g.addNodes([null, "x", {}])).toBe(0);
    expect(g.addEdges([null, {}])).toBe(0);
  });

  it("coerces edges with explicit id and familyId", () => {
    const g = new ContextGraph();
    g.addNodes([{ id: "a" }, { id: "b" }]);
    g.addEdges([{ source: "a", target: "b", type: "r", id: "e1", familyId: "f1" }]);
    expect(g.edges[0]?.id).toBe("e1");
    expect(g.edges[0]?.familyId).toBe("f1");
  });
});

describe("DecisionEngine — additional coverage", () => {
  it("findPrecedents excludes self", () => {
    const g = new ContextGraph();
    const id = g.decisions.recordDecision({
      category: "model", scenario: "choose llm", reasoning: "r", outcome: "o", confidence: 0.9,
    });
    const precedents = g.decisions.findPrecedents(id);
    expect(precedents).toEqual([]);
  });

  it("findPrecedentsByScenario with and without category", () => {
    const g = new ContextGraph();
    g.decisions.recordDecision({
      category: "lending", scenario: "personal loan approval", reasoning: "r", outcome: "o", confidence: 0.9,
    });
    expect(g.decisions.findPrecedentsByScenario("personal loan", "lending")).toHaveLength(1);
    expect(g.decisions.findPrecedentsByScenario("personal loan", "other")).toHaveLength(0);
    expect(g.decisions.findPrecedentsByScenario("personal loan")).toHaveLength(1);
  });

  it("checkDecisionRules with string id and missing decision", () => {
    const g = new ContextGraph();
    expect(() => g.decisions.checkDecisionRules("missing", [])).toThrow(/not found/);
    const id = g.decisions.recordDecision({
      category: "c", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.5,
    });
    expect(g.decisions.checkDecisionRules(id, [])).toEqual([]);
  });

  it("all() returns recorded decisions", () => {
    const g = new ContextGraph();
    g.decisions.recordDecision({
      category: "c", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.5,
    });
    expect(g.decisions.all()).toHaveLength(1);
  });

  it("rebuildFromNodes restores indexes", () => {
    const g = new ContextGraph();
    g.decisions.recordDecision({
      category: "c", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.5,
    });
    const data = g.toKgDict();
    const g2 = new ContextGraph();
    g2.loadData(data);
    expect(g2.decisions.all()).toHaveLength(1);
  });

  it("addCausalRelationship skips non-decision or missing nodes", () => {
    const g = new ContextGraph();
    g.addNode("a", "entity");
    g.addNode("b", "entity");
    g.decisions.addCausalRelationship("a", "b", "CAUSED"); // non-decision -> skip
    expect(g.edges).toHaveLength(0);
  });

  it("addCausalRelationship throws on invalid type", () => {
    const g = new ContextGraph();
    expect(() => g.decisions.addCausalRelationship("a", "b", "BAD")).toThrow(/must be one of/);
  });
});

describe("Reasoning — additional coverage", () => {
  it("Reasoner infer with no rules", () => {
    const r = new Reasoner();
    r.addFact({ subject: "a", predicate: "p", object: "b" });
    expect(r.infer()).toEqual([]);
  });

  it("Reasoner handles rule with empty conditions", () => {
    const r = new Reasoner();
    r.addRule({
      id: "r", name: "r", ruleType: "implication", confidence: 1, priority: 0,
      conditions: [],
      conclusion: { subject: "x", predicate: "y", object: "z" },
    });
    const results = r.infer();
    expect(results).toHaveLength(1);
  });

  it("ReteEngine handles empty-condition rule", () => {
    const r = new ReteEngine();
    r.addRule({
      id: "r", name: "r", ruleType: "implication", confidence: 1, priority: 0,
      conditions: [],
      conclusion: { subject: "x", predicate: "y", object: "z" },
    });
    expect(r.run()).toHaveLength(1);
  });

  it("SparqlReasoner returns empty on no match", () => {
    const r = new SparqlReasoner();
    expect(r.select({ subject: "a", predicate: "p", object: "o" })).toEqual([]);
  });

  it("GraphReasoner abduce with no matching rule", () => {
    const r = new GraphReasoner();
    expect(r.abduce([{ subject: "a", predicate: "p", object: "b" }])).toEqual([]);
  });
});

describe("Analytics — additional coverage", () => {
  it("computeCentrality covers all kinds", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel");
    const data = g.toKgDict();
    const adj = buildAdjacency(data.nodes.map((n) => n.id), data.edges);
    const kinds = ["degree", "in_degree", "out_degree", "betweenness", "closeness", "eigenvector", "pagerank"] as const;
    const centralities = computeCentrality(adj, [...kinds]);
    for (const k of kinds) expect(centralities[k]).toBeDefined();
  });

  it("detectCommunities and modularity", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel");
    const adj = buildAdjacency(["a", "b"], g.edges);
    const communities = detectCommunities(adj);
    expect(Object.keys(communities).length).toBe(2);
    expect(modularity(adj, communities)).toBeGreaterThan(-1);
  });

  it("commonNeighbors returns count", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "c", "rel");
    g.addEdge("b", "c", "rel");
    const adj = buildAdjacency(["a", "b", "c"], g.edges);
    expect(commonNeighbors(adj, "a", "b")).toBe(1);
  });

  it("nodeSimilarity with missing embeddings", () => {
    expect(nodeSimilarity(undefined, [1, 0])).toBe(0);
  });
});

describe("Provenance — additional coverage", () => {
  it("getAllSources and toProvoTurtle", () => {
    const prov = new ProvenanceManager();
    prov.trackEntity("e", "src", { location: "loc", method: "m", confidence: 0.9 });
    const sources = prov.getAllSources("e");
    expect(sources[0]?.source).toBe("src");
    expect(prov.toProvoTurtle()).toContain("prov:wasGeneratedBy");
    expect(prov.verifyIntegrity("e", "wrong")).toBe(false);
  });
});

describe("Dedup — additional coverage", () => {
  it("blocking_v2 uses prefix buckets", () => {
    const detector = new DuplicateDetector(0.85);
    const entities = [
      { id: "1", name: "Apple Inc." },
      { id: "2", name: "Apple" },
      { id: "3", name: "Microsoft" },
    ];
    expect(detector.detectDuplicates(entities, "blocking_v2")).toHaveLength(1);
  });

  it("hybrid_v2 uses embeddings", () => {
    const detector = new DuplicateDetector(0.85);
    const entities = [
      { id: "1", name: "Apple", embedding: [1, 0] },
      { id: "2", name: "Apple Inc", embedding: [0.99, 0.01] },
    ];
    expect(detector.detectDuplicates(entities, "hybrid_v2")).toHaveLength(1);
  });

  it("EntityMerger.mergeDuplicates union attributes", () => {
    const merger = new EntityMerger();
    const merged = merger.mergeDuplicates(
      [
        { id: "1", name: "Apple Inc.", city: "Cupertino" },
        { id: "2", name: "Apple", ceo: "Tim Cook" },
      ],
      "v1",
      0.85,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.city).toBe("Cupertino");
  });
});

describe("Conflicts — additional coverage", () => {
  it("resolve most_reliable and manual", () => {
    const detector = new ConflictDetector();
    detector.addClaim("x", "p", "a", "s1", { reliability: 0.9 });
    detector.addClaim("x", "p", "b", "s2", { reliability: 0.5 });
    const conflicts = detector.detectConflicts();
    expect(detector.resolve(conflicts, "most_reliable")[0]?.resolved).toBe("a");
    expect(detector.resolve(conflicts, "manual")[0]?.resolved).toBeNull();
  });

  it("triplesToClaims", () => {
    const detector = triplesToClaims([
      { subject: "x", predicate: "p", object: "a", source: "s1" },
      { subject: "x", predicate: "p", object: "b", source: "s2" },
    ]);
    expect(detector.detectConflicts()).toHaveLength(1);
  });
});

describe("VectorStore — additional coverage", () => {
  it("throws on dimension mismatch and addDocuments", () => {
    const store = new VectorStore(2);
    expect(() => store.add("a", [1])).toThrow(/dimension/);
    store.addDocuments(["apple", "banana"], (t) => (t === "apple" ? [1, 0] : [0, 1]));
    expect(store.size).toBe(2);
  });

  it("keywordSearch and filtered search", () => {
    const store = new VectorStore(2);
    store.add("a", [1, 0], "apple fruit", { cat: "f" });
    store.add("b", [0, 1], "banana", { cat: "f" });
    expect(store.keywordSearch("apple")[0]?.id).toBe("a");
    const filtered = store.search([1, 0], 10, (m) => m.cat === "f");
    expect(filtered[0]?.id).toBe("a");
  });
});

describe("Temporal — additional coverage", () => {
  it("allenRelation covers more relations", () => {
    const tq = new TemporalGraphQuery();
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-01-01", end: "2020-06-01" })).toBe("equals");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-06-01", end: "2020-12-01" })).toBe("meets");
    expect(tq.allenRelation({ start: "2020-03-01", end: "2020-04-01" }, { start: "2020-01-01", end: "2020-06-01" })).toBe("during");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-03-01" }, { start: "2020-02-01", end: "2020-04-01" })).toBe("overlaps");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-01-01", end: "2020-03-01" })).toBe("started_by");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-03-01" }, { start: "2020-01-01", end: "2020-06-01" })).toBe("starts");
    expect(tq.allenRelation({ start: "2020-03-01", end: "2020-06-01" }, { start: "2020-01-01", end: "2020-06-01" })).toBe("finishes");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-03-01", end: "2020-06-01" })).toBe("finished_by");
  });
});

describe("Exporters — additional coverage", () => {
  const graph = {
    graph_id: "g1",
    nodes: [{ id: "apple inc", type: "Organization", content: "Apple \"Inc\"", properties: { founded: 1976 } }],
    edges: [{ id: "e1", familyId: "e1", source_id: "apple inc", target_id: "cupertino", type: "located_in", weight: 1, properties: {} }],
  };

  it("exports JSON-LD", () => {
    const jsonld = new RDFExporter().export(graph, "json-ld");
    expect(jsonld).toContain("@graph");
  });

  it("exports N-Triples", () => {
    const nt = new RDFExporter().export(graph, "nt");
    expect(nt).toContain("located_in");
  });

  it("throws on unsupported format", () => {
    expect(() => new RDFExporter().export(graph, "bad" as any)).toThrow(/Unsupported/);
  });

  it("CSV escapes special chars", () => {
    const csv = new CSVExporter().export(graph);
    expect(csv.nodes).toContain('"');
  });
});
