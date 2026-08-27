/**
 * Decision Intelligence — the accountability layer of semantica.
 *
 * Every agent decision is a first-class object: recorded, causally linked,
 * searchable by precedent, and governable by policy rules.
 */
import type {
  CausalRelationshipType,
  Decision,
  GraphEdge,
  GraphNode,
  Properties,
} from "../types.js";
import { CAUSAL_EDGE_ALIASES, CAUSAL_TRAVERSAL_TYPES } from "../types.js";
import { normalizeTemporalInput, tokenize, uuid } from "../utils.js";

export interface RecordDecisionInput {
  category: string;
  scenario: string;
  reasoning: string;
  outcome: string;
  confidence: number;
  entities?: string[];
  decision_maker?: string | null;
  metadata?: Properties;
  valid_from?: string | number | Date | null;
  valid_until?: string | number | Date | null;
  [key: string]: unknown;
}

export interface DecisionRule {
  name: string;
  description?: string;
  /** A predicate over the decision record; returns a pass/fail verdict. */
  check: (decision: Decision) => { pass: boolean; reason: string };
}

export interface DecisionInsights {
  total: number;
  by_category: Record<string, number>;
  avg_confidence: number;
  confidence_distribution: Record<string, number>;
  recent: Decision[];
  top_categories: Array<{ category: string; count: number }>;
}

/** Normalize a causal relationship spelling to its canonical form. */
export function normalizeCausalType(
  relationshipType: string,
): CausalRelationshipType {
  const key = relationshipType.trim().toUpperCase();
  const canonical = CAUSAL_EDGE_ALIASES[key];
  if (!canonical) {
    throw new Error(
      `Relationship type must be one of: CAUSED, INFLUENCED, PRECEDENT_FOR`,
    );
  }
  return canonical;
}

/**
 * Decision engine — manages the decision lifecycle (record, link, query,
 * govern, audit) on top of a graph's node/edge store.
 */
export class DecisionEngine {
  private decisions = new Map<string, Decision>();
  private categoryIndex = new Map<string, Set<string>>();
  private entityIndex = new Map<string, Set<string>>();
  private temporalIndex: Array<{ id: string; ts: number }> = [];

  /** Graph accessors injected by the owning ContextGraph. */
  private hasNode: (id: string) => boolean;
  private getNodeType: (id: string) => string | undefined;
  private addNodeInternal: (node: GraphNode) => void;
  private addEdgeInternal: (edge: GraphEdge) => void;
  private getEdges: () => GraphEdge[];

  constructor(deps: {
    hasNode: (id: string) => boolean;
    getNodeType: (id: string) => string | undefined;
    addNodeInternal: (node: GraphNode) => void;
    addEdgeInternal: (edge: GraphEdge) => void;
    getEdges: () => GraphEdge[];
  }) {
    this.hasNode = deps.hasNode;
    this.getNodeType = deps.getNodeType;
    this.addNodeInternal = deps.addNodeInternal;
    this.addEdgeInternal = deps.addEdgeInternal;
    this.getEdges = deps.getEdges;
  }

  /** Record a decision with full structured context. Returns the decision id. */
  recordDecision(input: RecordDecisionInput): string {
    const {
      category,
      scenario,
      reasoning,
      outcome,
      confidence,
      entities = [],
      decision_maker = null,
      metadata = {},
      valid_from = null,
      valid_until = null,
    } = input;

    if (!category?.trim()) throw new Error("Category must be a non-empty string");
    if (category.trim().length > 100) throw new Error("Category must be 100 characters or less");
    if (!scenario?.trim()) throw new Error("Scenario must be a non-empty string");
    if (scenario.trim().length > 5000) throw new Error("Scenario must be 5000 characters or less");
    if (!reasoning?.trim()) throw new Error("Reasoning must be a non-empty string");
    if (reasoning.trim().length > 10000) throw new Error("Reasoning must be 10000 characters or less");
    if (!outcome?.trim()) throw new Error("Outcome must be a non-empty string");
    if (outcome.trim().length > 1000) throw new Error("Outcome must be 1000 characters or less");
    if (typeof confidence !== "number" || Number.isNaN(confidence)) {
      throw new Error("Confidence must be a number");
    }
    if (confidence < 0 || confidence > 1) {
      throw new Error("Confidence must be between 0.0 and 1.0");
    }
    for (const entity of entities) {
      if (typeof entity !== "string" || !entity.trim()) {
        throw new Error("Each entity must be a non-empty string");
      }
    }

    const id = uuid();
    const timestamp = Date.now();
    const recorded_at = new Date().toISOString();

    const decision: Decision = {
      id,
      category: category.trim(),
      scenario: scenario.trim(),
      reasoning: reasoning.trim(),
      outcome: outcome.trim(),
      confidence,
      entities: entities.map((e) => e.trim()).filter(Boolean),
      decision_maker: decision_maker?.trim() || null,
      timestamp,
      recorded_at,
      metadata: { ...metadata },
      validFrom: normalizeTemporalInput(valid_from),
      validUntil: normalizeTemporalInput(valid_until),
    };

    // Store as a graph node (first-class object).
    this.addNodeInternal({
      id,
      type: "decision",
      content: scenario.trim(),
      properties: {
        category: decision.category,
        scenario: decision.scenario,
        reasoning: decision.reasoning,
        outcome: decision.outcome,
        confidence: decision.confidence,
        entities: decision.entities,
        decision_maker: decision.decision_maker,
        timestamp: decision.timestamp,
        recorded_at: decision.recorded_at,
        ...decision.metadata,
      },
      metadata: decision.metadata,
      validFrom: decision.validFrom ?? null,
      validUntil: decision.validUntil ?? null,
    });

    this.decisions.set(id, decision);
    if (!this.categoryIndex.has(decision.category)) {
      this.categoryIndex.set(decision.category, new Set());
    }
    this.categoryIndex.get(decision.category)!.add(id);
    for (const entity of decision.entities) {
      if (!this.entityIndex.has(entity)) this.entityIndex.set(entity, new Set());
      this.entityIndex.get(entity)!.add(id);
    }
    this.temporalIndex.push({ id, ts: timestamp });
    this.temporalIndex.sort((a, b) => b.ts - a.ts);
    return id;
  }

  /** Link two decisions with a causal relationship (CAUSED / INFLUENCED / PRECEDENT_FOR). */
  addCausalRelationship(
    sourceDecisionId: string,
    targetDecisionId: string,
    relationshipType: string,
  ): void {
    const canonical = normalizeCausalType(relationshipType);
    if (!this.hasNode(sourceDecisionId) || !this.hasNode(targetDecisionId)) return;
    if (
      this.getNodeType(sourceDecisionId)?.toLowerCase() !== "decision" ||
      this.getNodeType(targetDecisionId)?.toLowerCase() !== "decision"
    ) {
      return;
    }
    const edge: GraphEdge = {
      id: uuid(),
      familyId: "",
      source_id: sourceDecisionId,
      target_id: targetDecisionId,
      type: canonical,
      weight: 1.0,
      properties: { recorded_at: new Date().toISOString() },
    };
    edge.familyId = edge.id;
    this.addEdgeInternal(edge);
  }

  /** Trace the causal chain (upstream or downstream) from a decision. */
  traceCausalChain(
    decisionId: string,
    direction: "upstream" | "downstream" = "upstream",
    maxDepth = 10,
  ): Array<Decision & { causal_distance: number }> {
    if (direction !== "upstream" && direction !== "downstream") {
      throw new Error("Direction must be 'upstream' or 'downstream'");
    }
    const edges = this.getEdges();
    const visited = new Set<string>();
    const queue: Array<[string, number]> = [[decisionId, 0]];
    const results: Array<Decision & { causal_distance: number }> = [];

    while (queue.length) {
      const [currentId, depth] = queue.shift()!;
      if (visited.has(currentId) || depth > maxDepth) continue;
      visited.add(currentId);
      if (currentId !== decisionId && this.decisions.has(currentId)) {
        const d = this.decisions.get(currentId)!;
        results.push({ ...d, causal_distance: depth });
      }
      for (const edge of edges) {
        if (!CAUSAL_TRAVERSAL_TYPES.has(edge.type.toUpperCase())) continue;
        if (direction === "upstream" && edge.target_id === currentId) {
          if (!visited.has(edge.source_id) && depth < maxDepth) {
            queue.push([edge.source_id, depth + 1]);
          }
        } else if (direction === "downstream" && edge.source_id === currentId) {
          if (!visited.has(edge.target_id) && depth < maxDepth) {
            queue.push([edge.target_id, depth + 1]);
          }
        }
      }
    }

    if (direction === "upstream") {
      results.sort((a, b) => b.causal_distance - a.causal_distance);
    } else {
      results.sort((a, b) => a.causal_distance - b.causal_distance);
    }
    return results;
  }

  /** Find similar decisions (precedents) by semantic keyword overlap. */
  findSimilarDecisions(
    query: string,
    maxResults = 5,
    minScore = 0,
  ): Array<{ decision: Decision; score: number }> {
    const qTokens = new Set(tokenize(query));
    if (qTokens.size === 0) return [];
    const scored: Array<{ decision: Decision; score: number }> = [];
    for (const decision of this.decisions.values()) {
      const doc = `${decision.category} ${decision.scenario} ${decision.reasoning} ${decision.outcome}`;
      const dTokens = tokenize(doc);
      let overlap = 0;
      for (const t of dTokens) if (qTokens.has(t)) overlap++;
      const score = overlap / qTokens.size;
      if (score >= minScore) scored.push({ decision, score });
    }
    scored.sort((a, b) => b.score - a.score || b.decision.timestamp - a.decision.timestamp);
    return scored.slice(0, maxResults);
  }

  /** Find precedents for an existing decision by id. */
  findPrecedents(decisionId: string, limit = 10): Array<{ decision: Decision; score: number }> {
    const d = this.decisions.get(decisionId);
    if (!d) return [];
    const self = this.findSimilarDecisions(
      `${d.category} ${d.scenario}`,
      limit + 1,
    );
    return self.filter((x) => x.decision.id !== decisionId).slice(0, limit);
  }

  /** Find precedents by scenario text. */
  findPrecedentsByScenario(
    scenario: string,
    category?: string,
    limit = 10,
  ): Array<{ decision: Decision; score: number }> {
    const results = this.findSimilarDecisions(
      `${category ?? ""} ${scenario}`.trim(),
      limit,
    );
    if (category) return results.filter((r) => r.decision.category === category);
    return results;
  }

  /** Analyze the downstream impact of a decision (everything it influenced). */
  analyzeDecisionImpact(decisionId: string): {
    downstream: Array<Decision & { causal_distance: number }>;
    upstream: Array<Decision & { causal_distance: number }>;
    influenced_categories: Record<string, number>;
  } {
    const downstream = this.traceCausalChain(decisionId, "downstream");
    const upstream = this.traceCausalChain(decisionId, "upstream");
    const influenced_categories: Record<string, number> = {};
    for (const d of downstream) {
      influenced_categories[d.category] = (influenced_categories[d.category] ?? 0) + 1;
    }
    return { downstream, upstream, influenced_categories };
  }

  /** Evaluate a set of policy rules against a decision. */
  checkDecisionRules(
    decisionOrId: Decision | string,
    rules: DecisionRule[] = [],
  ): Array<{ rule: string; pass: boolean; reason: string }> {
    const decision =
      typeof decisionOrId === "string"
        ? this.decisions.get(decisionOrId)
        : decisionOrId;
    if (!decision) throw new Error("Decision not found");
    return rules.map((rule) => {
      const verdict = rule.check(decision);
      return { rule: rule.name, pass: verdict.pass, reason: verdict.reason };
    });
  }

  /** Produce aggregate decision insights. */
  getDecisionInsights(): DecisionInsights {
    const all = [...this.decisions.values()];
    const by_category: Record<string, number> = {};
    const confidence_distribution: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
    };
    let sumConfidence = 0;
    for (const d of all) {
      by_category[d.category] = (by_category[d.category] ?? 0) + 1;
      if (d.confidence < 0.6) confidence_distribution.low!++;
      else if (d.confidence < 0.9) confidence_distribution.medium!++;
      else confidence_distribution.high!++;
      sumConfidence += d.confidence;
    }
    const top_categories = Object.entries(by_category)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
    return {
      total: all.length,
      by_category,
      avg_confidence: all.length ? sumConfidence / all.length : 0,
      confidence_distribution,
      recent: [...all].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
      top_categories,
    };
  }

  /** Restore decision indexes from graph nodes (called after graph load). */
  rebuildFromNodes(getNodes: () => GraphNode[]): void {
    this.decisions.clear();
    this.categoryIndex.clear();
    this.entityIndex.clear();
    this.temporalIndex = [];
    for (const node of getNodes()) {
      if (node.type.toLowerCase() !== "decision") continue;
      const decision: Decision = {
        id: node.id,
        category: node.properties.category ?? "",
        scenario: node.properties.scenario ?? node.content,
        reasoning: node.properties.reasoning ?? "",
        outcome: node.properties.outcome ?? "",
        confidence: node.properties.confidence ?? 0,
        entities: node.properties.entities ?? [],
        decision_maker: node.properties.decision_maker ?? null,
        timestamp: node.properties.timestamp ?? 0,
        recorded_at: node.properties.recorded_at ?? "",
        metadata: { ...node.metadata },
        validFrom: node.validFrom ?? null,
        validUntil: node.validUntil ?? null,
      };
      this.decisions.set(decision.id, decision);
      if (!this.categoryIndex.has(decision.category)) {
        this.categoryIndex.set(decision.category, new Set());
      }
      this.categoryIndex.get(decision.category)!.add(decision.id);
      for (const entity of decision.entities) {
        if (!this.entityIndex.has(entity)) this.entityIndex.set(entity, new Set());
        this.entityIndex.get(entity)!.add(decision.id);
      }
      this.temporalIndex.push({ id: decision.id, ts: decision.timestamp });
    }
    this.temporalIndex.sort((a, b) => b.ts - a.ts);
  }

  /** Export all decisions as plain objects. */
  all(): Decision[] {
    return [...this.decisions.values()];
  }
}
