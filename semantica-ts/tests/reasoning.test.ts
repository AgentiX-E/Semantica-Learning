import { describe, it, expect } from "vitest";
import {
  Reasoner,
  ReteEngine,
  DatalogReasoner,
  SparqlReasoner,
  GraphReasoner,
  createRule,
} from "../src/index.js";

describe("Reasoner — forward chaining", () => {
  it("applies IF/THEN rules to fixpoint", () => {
    const engine = new Reasoner();
    engine.addFact({ subject: "Alice", predicate: "is_a", object: "Manager" });
    engine.addRule(
      createRule(
        "manager-authority",
        [{ subject: "?x", predicate: "is_a", object: "Manager" }],
        { subject: "?x", predicate: "has_authority", object: "true" },
      ),
    );
    const results = engine.infer();
    expect(results).toHaveLength(1);
    expect(results[0]?.conclusion).toBe("Alice has_authority true");
    expect(engine.facts.has("Alice has_authority true")).toBe(true);
  });

  it("deduplicates identical rules", () => {
    const engine = new Reasoner();
    const rule = createRule(
      "r",
      [{ subject: "?x", predicate: "p", object: "q" }],
      { subject: "?x", predicate: "p2", object: "q2" },
    );
    engine.addRule(rule);
    engine.addRule(rule);
    expect(engine.rules).toHaveLength(1);
  });

  it("transitively chains rules", () => {
    const engine = new Reasoner();
    engine.addFact({ subject: "A", predicate: "parent_of", object: "B" });
    engine.addFact({ subject: "B", predicate: "parent_of", object: "C" });
    engine.addRule(
      createRule(
        "ancestor-direct",
        [{ subject: "?a", predicate: "parent_of", object: "?b" }],
        { subject: "?a", predicate: "ancestor_of", object: "?b" },
      ),
    );
    engine.addRule(
      createRule(
        "ancestor-transitive",
        [
          { subject: "?a", predicate: "ancestor_of", object: "?b" },
          { subject: "?b", predicate: "ancestor_of", object: "?c" },
        ],
        { subject: "?a", predicate: "ancestor_of", object: "?c" },
      ),
    );
    const results = engine.infer();
    expect(engine.facts.has("A ancestor_of C")).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ReteEngine", () => {
  it("matches rules against facts", () => {
    const engine = new ReteEngine();
    engine.addFact({ subject: "Alice", predicate: "is_a", object: "Manager" });
    engine.addRule(
      createRule(
        "r",
        [{ subject: "?x", predicate: "is_a", object: "Manager" }],
        { subject: "?x", predicate: "has_authority", object: "true" },
      ),
    );
    const results = engine.run();
    expect(results).toHaveLength(1);
  });
});

describe("DatalogReasoner", () => {
  it("evaluates recursive Horn clauses (transitive closure)", () => {
    const reasoner = new DatalogReasoner();
    reasoner.addFact({ predicate: "parent", args: ["alice", "bob"] });
    reasoner.addFact({ predicate: "parent", args: ["bob", "carol"] });
    reasoner.addRule("ancestor(X, Y) :- parent(X, Y).");
    reasoner.addRule("ancestor(X, Z) :- parent(X, Y), ancestor(Y, Z).");
    reasoner.evaluate();
    const results = reasoner.query("ancestor(alice, Z)");
    expect(results.map((r) => r.args)).toContainEqual(["alice", "bob"]);
    expect(results.map((r) => r.args)).toContainEqual(["alice", "carol"]);
  });
});

describe("SparqlReasoner", () => {
  it("selects triples matching a pattern", () => {
    const reasoner = new SparqlReasoner();
    reasoner.addTriple({ subject: "Apple", predicate: "founded_by", object: "Steve Jobs" });
    const rows = reasoner.select({ subject: "Apple", predicate: "founded_by", object: "?who" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["?who"]).toBe("Steve Jobs");
  });
});

describe("GraphReasoner — deductive & abductive", () => {
  it("performs deductive inference", () => {
    const reasoner = new GraphReasoner();
    reasoner.addFact({ subject: "a", predicate: "parent_of", object: "b" });
    reasoner.addRule({
      if: [{ subject: "?a", predicate: "parent_of", object: "?b" }],
      then: { subject: "?a", predicate: "ancestor_of", object: "?b" },
    });
    const results = reasoner.infer();
    expect(results).toHaveLength(1);
  });

  it("abduces hypotheses from evidence", () => {
    const reasoner = new GraphReasoner();
    reasoner.addRule({
      if: [{ subject: "?x", predicate: "is_a", object: "Manager" }],
      then: { subject: "?x", predicate: "has_authority", object: "true" },
    });
    const hypotheses = reasoner.abduce([
      { subject: "Alice", predicate: "has_authority", object: "true" },
    ]);
    expect(hypotheses[0]?.hypothesis).toEqual({
      subject: "Alice",
      predicate: "is_a",
      object: "Manager",
    });
  });
});
