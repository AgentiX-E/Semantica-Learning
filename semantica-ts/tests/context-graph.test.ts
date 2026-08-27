import { describe, it, expect } from "vitest";
import { ContextGraph } from "../src/index.js";

describe("ContextGraph — nodes & edges", () => {
  it("adds nodes and edges with typed indexes", () => {
    const g = new ContextGraph();
    expect(g.addNode("acme", "Organization", "Acme Corp", { industry: "SaaS" })).toBe(true);
    expect(g.addNode("alice", "Person", "Alice Chen", { role: "CTO" })).toBe(true);
    expect(g.addEdge("alice", "acme", "works_for", 1.0)).toBe(true);

    expect(g.hasNode("acme")).toBe(true);
    expect(g.getNode("acme")?.type).toBe("Organization");
    expect(g.getNodesByLabel("Person")).toHaveLength(1);
    expect(g.getNodeProperty("acme", "industry")).toBe("SaaS");
  });

  it("deduplicates node ids on re-add", () => {
    const g = new ContextGraph();
    expect(g.addNode("x", "Type")).toBe(true);
    expect(g.addNode("x", "Type", "content")).toBe(false);
    expect(g.nodes.size).toBe(1);
  });

  it("coerces raw node dicts with flexible keys", () => {
    const g = new ContextGraph();
    const added = g.addNodes([
      { id: "a", type: "Person", name: "Alice" },
      { node_id: "b", node_type: "Org", text: "Acme" },
      { id: "", type: "x" }, // should be skipped
    ]);
    expect(added).toBe(2);
    expect(g.hasNode("a")).toBe(true);
    expect(g.getNode("a")?.content).toBe("Alice");
    expect(g.getNode("b")?.type).toBe("Org");
  });

  it("coerces raw edge dicts with flexible keys", () => {
    const g = new ContextGraph();
    g.addNodes([{ id: "a" }, { id: "b" }]);
    const added = g.addEdges([
      { source: "a", target: "b", type: "rel" },
      { source_id: "b", target_id: "a", relationship: "rel2" },
    ]);
    expect(added).toBe(2);
    expect(g.edges).toHaveLength(2);
  });
});

describe("ContextGraph — traversal", () => {
  it("performs BFS neighbor discovery", () => {
    const g = new ContextGraph();
    g.addNode("a", "e", "A");
    g.addNode("b", "e", "B");
    g.addNode("c", "e", "C");
    g.addEdge("a", "b", "rel");
    g.addEdge("b", "c", "rel");
    const neighbors = g.getNeighbors("a", 2);
    expect(neighbors.map((n) => n.id).sort()).toEqual(["b", "c"]);
    expect(neighbors.find((n) => n.id === "c")?.hop).toBe(2);
  });

  it("filters neighbors by relationship type and min weight", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "b", "strong", 1.0);
    g.addEdge("a", "c", "weak", 0.1);
    expect(g.getNeighbors("a", 1, ["strong"])).toHaveLength(1);
    expect(g.getNeighbors("a", 1, undefined, 0.5)).toHaveLength(1);
  });

  it("includes distance metadata when requested", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel");
    const [n] = g.getNeighbors("a", 1, undefined, 0, 0, undefined, true);
    expect(n?.distance_band).toBe("near");
    expect(n?.path_to_anchor).toEqual(["a", "b"]);
  });

  it("runs keyword query", () => {
    const g = new ContextGraph();
    g.addNode("a", "e", "apple founded");
    g.addNode("b", "e", "google search");
    const results = g.query("apple");
    expect(results).toHaveLength(1);
    expect(results[0]?.node.id).toBe("a");
  });
});

describe("ContextGraph — temporal", () => {
  it("returns state at a point in time", () => {
    const g = new ContextGraph();
    g.addNode("alice", "Person", "Alice", { valid_from: "2018-01-01", valid_until: "2022-06-01" });
    g.addNode("acme", "Org", "Acme");
    const s2020 = g.stateAt("2020-06-15");
    const s2023 = g.stateAt("2023-01-01");
    expect(s2020.nodes.map((n) => n.id).sort()).toEqual(["acme", "alice"]);
    expect(s2023.nodes.map((n) => n.id)).toEqual(["acme"]);
  });
});

describe("ContextGraph — analytics", () => {
  it("computes centrality measures", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "b", "rel");
    g.addEdge("b", "c", "rel");
    const centrality = g.getNodeCentrality("b");
    expect(centrality.degree).toBe(2);
  });

  it("analyzes graph metrics", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addEdge("a", "b", "rel");
    const analysis = g.analyzeGraphWithKg();
    expect(analysis.node_count).toBe(2);
    expect(analysis.edge_count).toBe(1);
  });

  it("finds shortest path", () => {
    const g = new ContextGraph();
    g.addNode("a", "e");
    g.addNode("b", "e");
    g.addNode("c", "e");
    g.addEdge("a", "b", "rel");
    g.addEdge("b", "c", "rel");
    const path = g.findShortestPath("a", "c");
    expect(path?.path).toEqual(["a", "b", "c"]);
  });
});

describe("ContextGraph — serialization", () => {
  it("round-trips through toKgDict/loadData", () => {
    const g = new ContextGraph();
    g.addNode("a", "Person", "Alice");
    g.addNode("b", "Org", "Acme");
    g.addEdge("a", "b", "works_for");
    const data = g.toKgDict();

    const g2 = new ContextGraph();
    g2.loadData(data);
    expect(g2.hasNode("a")).toBe(true);
    expect(g2.edges).toHaveLength(1);
  });
});
