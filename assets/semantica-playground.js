/**
 * Semantica 交互实验室 — 浏览器内可运行的 mini 版 semantica 核心。
 *
 * 这是一个自包含、零依赖的 JavaScript 实现，复刻了 Semantica 的三个最核心能力：
 *   1. ContextGraph —— 图存储 + BFS 遍历 + 时序快照
 *   2. DecisionEngine —— 决策智能（记录 / 因果链 / 判例检索 / 策略门禁）
 *   3. Reasoner —— 前向链式推理引擎
 *
 * 用于让学习者在浏览器里亲手运行、观察结果，无需安装任何依赖。
 */
(function (global) {
  "use strict";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter(Boolean);
  }

  function isActive(validFrom, validUntil, at) {
    if (!validFrom && !validUntil) return true;
    const start = validFrom ? new Date(validFrom).getTime() : null;
    const end = validUntil ? new Date(validUntil).getTime() : null;
    if (start && at.getTime() < start) return false;
    if (end && at.getTime() > end) return false;
    return true;
  }

  class ContextGraph {
    constructor() {
      this.graphId = uuid();
      this.nodes = new Map();
      this.edges = [];
      this.adjacency = new Map();
      this.nodeTypeIndex = new Map();
      this.decisions = new DecisionEngine(this);
    }

    addNode(id, type, content, properties) {
      id = String(id);
      const node = {
        id,
        type: String(type || "entity"),
        content: content || id,
        properties: { ...(properties || {}) },
        validFrom: (properties || {}).valid_from || null,
        validUntil: (properties || {}).valid_until || null,
      };
      if (this.nodes.has(id)) {
        Object.assign(this.nodes.get(id).properties, node.properties);
        return false;
      }
      this.nodes.set(id, node);
      if (!this.nodeTypeIndex.has(node.type)) this.nodeTypeIndex.set(node.type, new Set());
      this.nodeTypeIndex.get(node.type).add(id);
      if (!this.adjacency.has(id)) this.adjacency.set(id, []);
      return true;
    }

    addEdge(source, target, type, weight) {
      source = String(source);
      target = String(target);
      const edge = {
        id: uuid(),
        familyId: uuid(),
        source_id: source,
        target_id: target,
        type: String(type || "related_to"),
        weight: weight === undefined ? 1 : Number(weight),
      };
      this.edges.push(edge);
      if (!this.adjacency.has(source)) this.adjacency.set(source, []);
      this.adjacency.get(source).push(edge);
      return true;
    }

    getNeighbors(nodeId, hops, relTypes, minWeight) {
      nodeId = String(nodeId);
      if (!this.nodes.has(nodeId)) return [];
      hops = hops || 1;
      const neighbors = [];
      const visited = new Set([nodeId]);
      const queue = [[nodeId, 0, 1.0, [nodeId]]];
      const filter = relTypes ? new Set(relTypes) : null;
      while (queue.length) {
        const [cur, hop, decay, path] = queue.shift();
        if (hop >= hops) continue;
        for (const e of this.adjacency.get(cur) || []) {
          if (filter && !filter.has(e.type)) continue;
          if (minWeight !== undefined && e.weight < minWeight) continue;
          const nb = e.target_id;
          if (visited.has(nb)) continue;
          visited.add(nb);
          const nextHop = hop + 1;
          const nextDecay = decay * e.weight;
          const nextPath = [...path, nb];
          queue.push([nb, nextHop, nextDecay, nextPath]);
          const node = this.nodes.get(nb);
          if (!node) continue;
          neighbors.push({
            id: node.id,
            type: node.type,
            content: node.content,
            relationship: e.type,
            weight: e.weight,
            hop: nextHop,
            distance_band: nextHop <= 1 ? "near" : nextHop <= 3 ? "mid" : "far",
            path: nextPath,
          });
        }
      }
      return neighbors;
    }

    stateAt(at) {
      const d = new Date(at);
      return {
        nodes: [...this.nodes.values()].filter((n) => isActive(n.validFrom, n.validUntil, d)),
        edges: this.edges.filter((e) => isActive(e.validFrom, e.validUntil, d)),
      };
    }

    getCentrality(nodeId) {
      nodeId = String(nodeId);
      const inDeg = this.edges.filter((e) => e.target_id === nodeId).length;
      const outDeg = this.edges.filter((e) => e.source_id === nodeId).length;
      return { degree: inDeg + outDeg, in_degree: inDeg, out_degree: outDeg };
    }

    toJSON() {
      return {
        graph_id: this.graphId,
        nodes: [...this.nodes.values()],
        edges: this.edges,
      };
    }
  }

  class DecisionEngine {
    constructor(graph) {
      this.graph = graph;
      this.decisions = new Map();
      this.categoryIndex = new Map();
    }

    recordDecision(input) {
      const { category, scenario, reasoning, outcome, confidence, entities } = input;
      const id = uuid();
      const decision = {
        id,
        category: category.trim(),
        scenario: scenario.trim(),
        reasoning: reasoning.trim(),
        outcome: outcome.trim(),
        confidence: Number(confidence),
        entities: (entities || []).map((e) => e.trim()),
        timestamp: Date.now(),
        recorded_at: new Date().toISOString(),
      };
      this.graph.addNode(id, "decision", scenario.trim(), {
        category: decision.category,
        reasoning: decision.reasoning,
        outcome: decision.outcome,
        confidence: decision.confidence,
      });
      this.decisions.set(id, decision);
      if (!this.categoryIndex.has(decision.category)) this.categoryIndex.set(decision.category, []);
      this.categoryIndex.get(decision.category).push(id);
      return id;
    }

    addCausalRelationship(source, target, type) {
      if (!this.graph.nodes.has(source) || !this.graph.nodes.has(target)) return;
      this.graph.addEdge(source, target, type, 1.0);
    }

    traceCausalChain(id, direction, maxDepth) {
      direction = direction || "upstream";
      maxDepth = maxDepth || 10;
      const visited = new Set();
      const queue = [[id, 0]];
      const result = [];
      while (queue.length) {
        const [cur, depth] = queue.shift();
        if (visited.has(cur) || depth > maxDepth) continue;
        visited.add(cur);
        if (cur !== id && this.decisions.has(cur)) {
          result.push({ ...this.decisions.get(cur), causal_distance: depth });
        }
        for (const e of this.graph.edges) {
          const isCausal = /^(CAUSED|INFLUENCED|PRECEDENT_FOR|CAUSES|INFLUENCES|LEADS_TO)$/i.test(e.type);
          if (!isCausal) continue;
          if (direction === "upstream" && e.target_id === cur && !visited.has(e.source_id)) {
            queue.push([e.source_id, depth + 1]);
          } else if (direction === "downstream" && e.source_id === cur && !visited.has(e.target_id)) {
            queue.push([e.target_id, depth + 1]);
          }
        }
      }
      result.sort((a, b) => (direction === "upstream" ? b.causal_distance - a.causal_distance : a.causal_distance - b.causal_distance));
      return result;
    }

    findSimilarDecisions(query, maxResults) {
      const qTokens = new Set(tokenize(query));
      const scored = [];
      for (const d of this.decisions.values()) {
        const doc = `${d.category} ${d.scenario} ${d.reasoning} ${d.outcome}`;
        const dTokens = tokenize(doc);
        let overlap = 0;
        for (const t of dTokens) if (qTokens.has(t)) overlap++;
        const score = qTokens.size ? overlap / qTokens.size : 0;
        if (score > 0) scored.push({ decision: d, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, maxResults || 5);
    }

    checkDecisionRules(id, rules) {
      const d = this.decisions.get(id);
      if (!d) return [];
      return (rules || []).map((r) => {
        const v = r.check(d);
        return { rule: r.name, pass: v.pass, reason: v.reason };
      });
    }
  }

  class Reasoner {
    constructor() {
      this.facts = new Set();
      this.factList = [];
      this.rules = [];
    }

    addFact(subject, predicate, object) {
      const key = `${subject} ${predicate} ${object}`;
      if (this.facts.has(key)) return;
      this.facts.add(key);
      this.factList.push({ subject, predicate, object });
    }

    addRule(conditions, conclusion) {
      this.rules.push({ conditions, conclusion });
    }

    _unify(pattern, fact, bindings) {
      const pairs = [
        [pattern.subject, fact.subject],
        [pattern.predicate, fact.predicate],
        [pattern.object, fact.object],
      ];
      for (const [p, f] of pairs) {
        if (p.startsWith("?")) {
          if (bindings.has(p) && bindings.get(p) !== f) return null;
          bindings.set(p, f);
        } else if (p !== f) {
          return null;
        }
      }
      return bindings;
    }

    infer() {
      const results = [];
      let changed = true;
      while (changed) {
        changed = false;
        for (const rule of this.rules) {
          const matches = this._match(rule.conditions);
          for (const m of matches) {
            const conclusion = {
              subject: this._sub(m.bindings, rule.conclusion.subject),
              predicate: this._sub(m.bindings, rule.conclusion.predicate),
              object: this._sub(m.bindings, rule.conclusion.object),
            };
            const key = `${conclusion.subject} ${conclusion.predicate} ${conclusion.object}`;
            if (this.facts.has(key)) continue;
            this.addFact(conclusion.subject, conclusion.predicate, conclusion.object);
            results.push({ conclusion: key, premises: m.premises });
            changed = true;
          }
        }
      }
      return results;
    }

    _sub(bindings, term) {
      return term.startsWith("?") ? bindings.get(term) || term : term;
    }

    _match(conditions) {
      if (!conditions.length) return [{ bindings: new Map(), premises: [] }];
      let matches = [];
      const first = conditions[0];
      for (const fact of this.factList) {
        const b = this._unify(first, fact, new Map());
        if (b) matches.push({ bindings: b, premises: [`${fact.subject} ${fact.predicate} ${fact.object}`] });
      }
      for (const cond of conditions.slice(1)) {
        const next = [];
        for (const m of matches) {
          for (const fact of this.factList) {
            const b = this._unify(cond, fact, new Map(m.bindings));
            if (b) next.push({ bindings: b, premises: [...m.premises, `${fact.subject} ${fact.predicate} ${fact.object}`] });
          }
        }
        matches = next;
      }
      return matches;
    }
  }

  global.SemanticaPlayground = { ContextGraph, DecisionEngine, Reasoner, uuid, tokenize };
})(typeof window !== "undefined" ? window : globalThis);
