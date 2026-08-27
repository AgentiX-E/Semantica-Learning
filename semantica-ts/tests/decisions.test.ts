import { describe, it, expect } from "vitest";
import { ContextGraph } from "../src/index.js";

describe("Decision Intelligence", () => {
  it("records decisions as first-class graph nodes", () => {
    const g = new ContextGraph();
    const id = g.decisions.recordDecision({
      category: "loan_underwriting",
      scenario: "Underwriting review",
      reasoning: "DTI within policy",
      outcome: "approved",
      confidence: 0.94,
      entities: ["applicant_7291"],
    });
    expect(g.hasNode(id)).toBe(true);
    expect(g.getNode(id)?.type).toBe("decision");
  });

  it("validates decision inputs", () => {
    const g = new ContextGraph();
    expect(() =>
      g.decisions.recordDecision({
        category: "",
        scenario: "s",
        reasoning: "r",
        outcome: "o",
        confidence: 0.5,
      }),
    ).toThrow(/Category/);
    expect(() =>
      g.decisions.recordDecision({
        category: "c",
        scenario: "s",
        reasoning: "r",
        outcome: "o",
        confidence: 1.5,
      }),
    ).toThrow(/Confidence/);
  });

  it("builds causal chains (upstream & downstream)", () => {
    const g = new ContextGraph();
    const d1 = g.decisions.recordDecision({
      category: "credit_application",
      scenario: "loan app",
      reasoning: "r1",
      outcome: "proceed",
      confidence: 0.9,
    });
    const d2 = g.decisions.recordDecision({
      category: "underwriting",
      scenario: "underwrite",
      reasoning: "r2",
      outcome: "approved",
      confidence: 0.94,
    });
    g.decisions.addCausalRelationship(d1, d2, "CAUSED");

    const upstream = g.decisions.traceCausalChain(d2, "upstream");
    expect(upstream.map((d) => d.id)).toContain(d1);

    const downstream = g.decisions.traceCausalChain(d1, "downstream");
    expect(downstream.map((d) => d.id)).toContain(d2);
  });

  it("normalizes causal relationship spellings", () => {
    const g = new ContextGraph();
    const d1 = g.decisions.recordDecision({
      category: "a", scenario: "s", reasoning: "r", outcome: "o", confidence: 1,
    });
    const d2 = g.decisions.recordDecision({
      category: "b", scenario: "s", reasoning: "r", outcome: "o", confidence: 1,
    });
    g.decisions.addCausalRelationship(d1, d2, "causes");
    const chain = g.decisions.traceCausalChain(d2, "upstream");
    expect(chain.map((d) => d.id)).toContain(d1);
  });

  it("finds similar decisions (precedents)", () => {
    const g = new ContextGraph();
    g.decisions.recordDecision({
      category: "model_selection",
      scenario: "Choose LLM for production",
      reasoning: "benchmark advantage",
      outcome: "selected_gpt4",
      confidence: 0.9,
    });
    const results = g.decisions.findSimilarDecisions("LLM model selection", 5);
    expect(results).toHaveLength(1);
    expect(results[0]?.decision.category).toBe("model_selection");
  });

  it("analyzes decision impact", () => {
    const g = new ContextGraph();
    const d1 = g.decisions.recordDecision({
      category: "a", scenario: "s", reasoning: "r", outcome: "o", confidence: 1,
    });
    const d2 = g.decisions.recordDecision({
      category: "b", scenario: "s", reasoning: "r", outcome: "o", confidence: 1,
    });
    g.decisions.addCausalRelationship(d1, d2, "INFLUENCED");
    const impact = g.decisions.analyzeDecisionImpact(d1);
    expect(impact.downstream.map((d) => d.id)).toContain(d2);
    expect(impact.influenced_categories["b"]).toBe(1);
  });

  it("checks decision rules (policy gate)", () => {
    const g = new ContextGraph();
    const id = g.decisions.recordDecision({
      category: "loan_underwriting",
      scenario: "s",
      reasoning: "r",
      outcome: "o",
      confidence: 0.94,
    });
    const results = g.decisions.checkDecisionRules(id, [
      {
        name: "min_confidence",
        check: (d) => ({ pass: d.confidence >= 0.9, reason: `confidence ${d.confidence}` }),
      },
    ]);
    expect(results[0]?.pass).toBe(true);
  });

  it("produces decision insights", () => {
    const g = new ContextGraph();
    g.decisions.recordDecision({
      category: "a", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.5,
    });
    g.decisions.recordDecision({
      category: "a", scenario: "s", reasoning: "r", outcome: "o", confidence: 0.95,
    });
    const insights = g.decisions.getDecisionInsights();
    expect(insights.total).toBe(2);
    expect(insights.by_category["a"]).toBe(2);
    expect(insights.avg_confidence).toBeCloseTo(0.725);
  });
});
