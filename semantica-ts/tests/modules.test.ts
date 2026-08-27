import { describe, it, expect } from "vitest";
import {
  ProvenanceManager,
  EntityResolver,
  DuplicateDetector,
  ConflictDetector,
  OntologyGenerator,
  SHACLGenerator,
  OWLGenerator,
  SKOSVocabulary,
  VectorStore,
  TemporalGraphQuery,
  RDFExporter,
  CSVExporter,
  CypherExporter,
  jaroWinkler,
  cosineSimilarity,
} from "../src/index.js";

describe("utils", () => {
  it("computes Jaro-Winkler similarity", () => {
    expect(jaroWinkler("Apple", "Apple")).toBeCloseTo(1, 5);
    expect(jaroWinkler("Apple Inc.", "Apple")).toBeGreaterThan(0.8);
    expect(jaroWinkler("Apple", "Microsoft")).toBeLessThan(0.6);
  });

  it("computes cosine similarity", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1, 5);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe("ProvenanceManager", () => {
  it("tracks entity lineage with checksums", () => {
    const prov = new ProvenanceManager();
    prov.trackEntity("apple_inc", "data/report.pdf", { method: "NER", confidence: 0.98 });
    const lineage = prov.getLineage("apple_inc");
    expect(lineage).toHaveLength(1);
    expect(lineage[0]?.source).toBe("data/report.pdf");
    expect(prov.verifyIntegrity("apple_inc", "data/report.pdf")).toBe(true);
  });

  it("emits PROV-O turtle", () => {
    const prov = new ProvenanceManager();
    prov.trackEntity("apple_inc", "data/report.pdf");
    const turtle = prov.toProvoTurtle();
    expect(turtle).toContain("prov:wasDerivedFrom");
  });
});

describe("Deduplication / entity resolution", () => {
  it("detects duplicates via Jaro-Winkler (v1)", () => {
    const detector = new DuplicateDetector(0.85);
    const entities = [
      { id: "1", name: "Apple Inc." },
      { id: "2", name: "Apple" },
      { id: "3", name: "Microsoft" },
    ];
    const pairs = detector.detectDuplicates(entities, "v1");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a.id).toBe("1");
  });

  it("resolves duplicates via semantic embeddings", () => {
    const resolver = new EntityResolver();
    const entities = [
      { id: "1", name: "Apple", embedding: [1, 0, 0] },
      { id: "2", name: "Apple Inc", embedding: [0.99, 0.01, 0] },
      { id: "3", name: "Microsoft", embedding: [0, 1, 0] },
    ];
    const merged = resolver.resolve(entities, "semantic_v2");
    expect(merged).toHaveLength(2);
  });
});

describe("ConflictDetector", () => {
  it("detects and resolves value conflicts", () => {
    const detector = new ConflictDetector();
    detector.addClaim("apple", "ceo", "Tim Cook", "src1", { timestamp: 2020, reliability: 0.9 });
    detector.addClaim("apple", "ceo", "Steve Jobs", "src2", { timestamp: 2010, reliability: 0.7 });
    const conflicts = detector.detectConflicts();
    expect(conflicts).toHaveLength(1);
    const resolved = detector.resolve(conflicts, "most_recent");
    expect(resolved[0]?.resolved).toBe("Tim Cook");
  });

  it("uses majority vote", () => {
    const detector = new ConflictDetector();
    detector.addClaim("x", "p", "a", "s1");
    detector.addClaim("x", "p", "a", "s2");
    detector.addClaim("x", "p", "b", "s3");
    const resolved = detector.resolve(detector.detectConflicts(), "majority_vote");
    expect(resolved[0]?.resolved).toBe("a");
  });
});

describe("Ontology", () => {
  it("generates ontology and SHACL shapes", () => {
    const gen = new OntologyGenerator();
    const ontology = gen.generateFromGraph(
      [{ type: "Person" }, { type: "Organization" }],
      [{ type: "works_for" }],
    );
    expect(ontology.classes).toEqual(["Organization", "Person"]);

    const shacl = new SHACLGenerator();
    const shapes = shacl.generate(ontology);
    expect(shapes).toHaveLength(2);
  });

  it("validates nodes against SHACL shapes", () => {
    const shapes = [{ targetClass: "Person", properties: [{ path: "name", minCount: 1 }] }];
    const results = new SHACLGenerator().validate(shapes, [
      { type: "Person", properties: {} },
      { type: "Person", properties: { name: "Alice" } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.violations).toContain("Missing required property 'name'");
  });

  it("generates OWL turtle", () => {
    const owl = new OWLGenerator().generate({
      classes: ["Person"],
      relationships: ["works_for"],
      subclassOf: { Manager: "Person" },
    });
    expect(owl).toContain("owl:Class");
    expect(owl).toContain("rdfs:subClassOf");
  });

  it("manages SKOS vocabularies", () => {
    const skos = new SKOSVocabulary();
    skos.addConcept("dog", "Dog", "mammal");
    skos.addConcept("mammal", "Mammal");
    const turtle = skos.toTurtle();
    expect(turtle).toContain("skos:Concept");
    expect(turtle).toContain("skos:broader");
  });
});

describe("VectorStore", () => {
  it("performs semantic top-k search", () => {
    const store = new VectorStore(2);
    store.add("a", [1, 0], "apple");
    store.add("b", [0, 1], "banana");
    const results = store.search([1, 0], 2);
    expect(results[0]?.id).toBe("a");
  });

  it("hybrid search fuses vector + keyword results", () => {
    const store = new VectorStore(2);
    store.add("a", [1, 0], "apple fruit");
    store.add("b", [0, 1], "banana");
    const results = store.hybridSearch("apple", [1, 0], 2);
    expect(results[0]?.id).toBe("a");
  });
});

describe("TemporalGraphQuery", () => {
  it("queries graph at a point in time", () => {
    const tq = new TemporalGraphQuery();
    const result = tq.queryAtTime(
      [{ id: "alice", type: "Person", content: "Alice", properties: {}, metadata: {}, validFrom: "2018-01-01", validUntil: "2022-06-01" }],
      [],
      "2020-06-15",
    );
    expect(result.num_nodes).toBe(1);
  });

  it("computes Allen interval relations", () => {
    const tq = new TemporalGraphQuery();
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-07-01", end: "2021-01-01" })).toBe("before");
    expect(tq.allenRelation({ start: "2020-01-01", end: "2020-06-01" }, { start: "2020-03-01", end: "2020-04-01" })).toBe("contains");
  });
});

describe("Exporters", () => {
  const graph = {
    graph_id: "g1",
    nodes: [{ id: "apple", type: "Organization", content: "Apple", properties: {}, metadata: {} }],
    edges: [{ id: "e1", familyId: "e1", source_id: "apple", target_id: "cupertino", type: "located_in", weight: 1, properties: {} }],
  };

  it("exports RDF turtle", () => {
    const turtle = new RDFExporter().export(graph, "turtle");
    expect(turtle).toContain("rdf:type");
    expect(turtle).toContain("located_in");
  });

  it("exports CSV", () => {
    const csv = new CSVExporter().export(graph);
    expect(csv.nodes).toContain("apple");
    expect(csv.edges).toContain("located_in");
  });

  it("exports Cypher", () => {
    const cypher = new CypherExporter().export(graph);
    expect(cypher).toContain("CREATE");
  });
});
