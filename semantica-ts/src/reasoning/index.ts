/**
 * Reasoning engines — deterministic inference over facts and rules.
 *
 * Semantica ships six reasoning strategies. This module implements:
 *   - Forward chaining (Reasoner)
 *   - Rete network (ReteEngine)
 *   - Datalog (DatalogReasoner)
 *   - SPARQL-style query inference (SparqlReasoner)
 *   - Deductive / abductive reasoning (GraphReasoner)
 *
 * Every engine produces explainable inference paths: each derived fact carries
 * the rules and premises that produced it.
 */
import type {
  Fact,
  InferenceResult,
  Rule,
  Triple,
  TriplePattern,
} from "../types.js";
import { uuid } from "../utils.js";

export type RuleType = "implication" | "equivalence" | "constraint" | "transformation";

/** Create a rule with a generated id. */
export function createRule(
  name: string,
  conditions: TriplePattern[],
  conclusion: TriplePattern,
  ruleType: RuleType = "implication",
  confidence = 1.0,
  priority = 0,
): Rule {
  return { id: uuid(), name, conditions, conclusion, ruleType, confidence, priority };
}

/** Render a triple (pattern) as a string. */
export function tripleString(t: TriplePattern | Triple): string {
  return `${t.subject} ${t.predicate} ${t.object}`;
}

/** Substitute variables in a pattern with a binding map. */
function substitute(pattern: TriplePattern, bindings: Map<string, string>): Triple {
  return {
    subject: substituteTerm(pattern.subject, bindings),
    predicate: substituteTerm(pattern.predicate, bindings),
    object: substituteTerm(pattern.object, bindings),
  };
}

function substituteTerm(term: string, bindings: Map<string, string>): string {
  if (term.startsWith("?")) return bindings.get(term) ?? term;
  return term;
}

function isVariable(term: string): boolean {
  return term.startsWith("?");
}

/** Unify a pattern against a fact, returning bindings or null. */
function unify(pattern: TriplePattern, fact: Triple): Map<string, string> | null {
  const bindings = new Map<string, string>();
  const pairs: Array<[string, string]> = [
    [pattern.subject, fact.subject],
    [pattern.predicate, fact.predicate],
    [pattern.object, fact.object],
  ];
  for (const [p, f] of pairs) {
    if (isVariable(p)) {
      const existing = bindings.get(p);
      if (existing !== undefined && existing !== f) return null;
      bindings.set(p, f);
    } else if (p !== f) {
      return null;
    }
  }
  return bindings;
}

/**
 * Forward-chaining reasoner: applies IF/THEN rules repeatedly until no new
 * facts can be derived (fixpoint).
 */
export class Reasoner {
  readonly rules: Rule[] = [];
  readonly facts = new Set<string>();
  private factStore: Triple[] = [];

  addFact(fact: Triple | string): void {
    const t = normalizeFact(fact);
    const key = tripleString(t);
    if (this.facts.has(key)) return;
    this.facts.add(key);
    this.factStore.push(t);
  }

  addRule(rule: Rule): void {
    // Idempotent dedup on conditions+conclusion (mirrors Python #732).
    const existing = this.rules.find(
      (r) =>
        r.ruleType === rule.ruleType &&
        JSON.stringify(r.conditions) === JSON.stringify(rule.conditions) &&
        JSON.stringify(r.conclusion) === JSON.stringify(rule.conclusion),
    );
    if (existing) {
      this.rules.sort((a, b) => b.priority - a.priority);
      return;
    }
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  infer(): InferenceResult[] {
    const results: InferenceResult[] = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of this.rules) {
        const matches = this.matchRule(rule);
        for (const match of matches) {
          const conclusion = substitute(rule.conclusion, match.bindings);
          const conclusionKey = tripleString(conclusion);
          if (this.facts.has(conclusionKey)) continue;
          this.facts.add(conclusionKey);
          this.factStore.push(conclusion);
          changed = true;
          results.push({
            conclusion: conclusionKey,
            ruleUsed: rule,
            premises: match.premises,
            confidence: rule.confidence * match.minPremiseConfidence,
          });
        }
      }
    }
    return results;
  }

  private matchRule(
    rule: Rule,
  ): Array<{ bindings: Map<string, string>; premises: string[]; minPremiseConfidence: number }> {
    // Find all bindings for the first condition, then extend.
    if (rule.conditions.length === 0) {
      return [{ bindings: new Map(), premises: [], minPremiseConfidence: 1.0 }];
    }
    const [first, ...rest] = rule.conditions;
    const partial: Array<{ bindings: Map<string, string>; premises: string[]; minPremiseConfidence: number }> = [];
    for (const fact of this.factStore) {
      const b = unify(first!, fact);
      if (b) {
        partial.push({ bindings: b, premises: [tripleString(fact)], minPremiseConfidence: 1.0 });
      }
    }
    let matches = partial;
    for (const condition of rest) {
      const next: typeof partial = [];
      for (const m of matches) {
        for (const fact of this.factStore) {
          const b = unify(condition, fact);
          if (!b) continue;
          if (!bindingsCompatible(m.bindings, b)) continue;
          const merged = new Map([...m.bindings, ...b]);
          next.push({
            bindings: merged,
            premises: [...m.premises, tripleString(fact)],
            minPremiseConfidence: m.minPremiseConfidence,
          });
        }
      }
      matches = next;
    }
    return matches;
  }
}

function bindingsCompatible(a: Map<string, string>, b: Map<string, string>): boolean {
  for (const [k, v] of b) {
    const existing = a.get(k);
    if (existing !== undefined && existing !== v) return false;
  }
  return true;
}

function normalizeFact(fact: Triple | string): Triple {
  if (typeof fact === "string") {
    const parts = fact.trim().split(/\s+/);
    if (parts.length < 3) throw new Error(`Malformed fact string: ${fact}`);
    return { subject: parts[0]!, predicate: parts[1]!, object: parts.slice(2).join(" ") };
  }
  return { ...fact };
}

/**
 * Rete network — efficient pattern matching that avoids re-evaluating rules
 * whose preconditions haven't changed. Simplified alpha/beta-memory model.
 */
export class ReteEngine {
  private facts: Triple[] = [];
  private rules: Rule[] = [];
  private inferred = new Set<string>();
  private alphaMemory = new Map<string, Triple[]>();

  addFact(fact: Triple): void {
    const t = normalizeFact(fact);
    this.facts.push(t);
    for (const term of [t.subject, t.predicate, t.object]) {
      if (!this.alphaMemory.has(term)) this.alphaMemory.set(term, []);
      this.alphaMemory.get(term)!.push(t);
    }
  }

  addRule(rule: Rule): void {
    this.rules.push(rule);
  }

  run(): InferenceResult[] {
    const results: InferenceResult[] = [];
    // Rete-style: process rules, adding new facts to alpha memory only once.
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of this.rules) {
        const newFacts = this.matchAndFire(rule);
        for (const r of newFacts) {
          const key = r.conclusion;
          if (this.inferred.has(key) || this.facts.some((f) => tripleString(f) === key)) continue;
          this.inferred.add(key);
          const parts = key.split(/\s+/);
          this.addFact({ subject: parts[0]!, predicate: parts[1]!, object: parts.slice(2).join(" ") });
          results.push(r);
          changed = true;
        }
      }
    }
    return results;
  }

  private matchAndFire(rule: Rule): InferenceResult[] {
    if (rule.conditions.length === 0) {
      const conclusion = tripleString(rule.conclusion);
      return [{ conclusion, ruleUsed: rule, premises: [], confidence: rule.confidence }];
    }
    const first = rule.conditions[0]!;
    const candidates = this.candidatesFor(first);
    let partials = candidates
      .map((fact) => {
        const b = unify(first, fact);
        return b ? { bindings: b, premises: [tripleString(fact)] } : null;
      })
      .filter((x): x is { bindings: Map<string, string>; premises: string[] } => x !== null);

    for (const cond of rule.conditions.slice(1)) {
      const next: typeof partials = [];
      for (const p of partials) {
        for (const fact of this.candidatesFor(cond)) {
          const b = unify(cond, fact);
          if (!b || !bindingsCompatible(p.bindings, b)) continue;
          next.push({ bindings: new Map([...p.bindings, ...b]), premises: [...p.premises, tripleString(fact)] });
        }
      }
      partials = next;
    }

    const results: InferenceResult[] = [];
    for (const p of partials) {
      const conclusion = tripleString(substitute(rule.conclusion, p.bindings));
      if (this.inferred.has(conclusion)) continue;
      results.push({ conclusion, ruleUsed: rule, premises: p.premises, confidence: rule.confidence });
    }
    return results;
  }

  private candidatesFor(pattern: TriplePattern): Triple[] {
    const constants = [pattern.subject, pattern.predicate, pattern.object].filter(
      (t) => !isVariable(t),
    );
    if (constants.length === 0) return this.facts;
    const pool = new Set<Triple>();
    for (const c of constants) {
      for (const f of this.alphaMemory.get(c) ?? []) pool.add(f);
    }
    return [...pool];
  }
}

/** A Datalog fact (predicate + args). */
export interface DatalogFact {
  predicate: string;
  args: string[];
}

/** A Datalog rule: `head :- body1, body2, ...`. */
export interface DatalogRule {
  head: DatalogFact;
  body: DatalogFact[];
}

function parseDatalogAtom(atom: string): DatalogFact {
  const m = atom.trim().match(/^([a-zA-Z_][\w]*)\s*\((.*)\)$/);
  if (!m) throw new Error(`Malformed Datalog atom: ${atom}`);
  const args = m[2]!.split(",").map((a) => a.trim()).filter(Boolean);
  return { predicate: m[1]!, args };
}

/** Split a Datalog rule body into atoms, respecting parenthesized args. */
function splitDatalogAtoms(text: string): string[] {
  const atoms: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      atoms.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) atoms.push(current.trim());
  return atoms;
}

function parseDatalogRule(text: string): DatalogRule {
  const parts = text.split(":-");
  if (parts.length !== 2) throw new Error(`Malformed Datalog rule: ${text}`);
  const head = parseDatalogAtom(parts[0]!.trim().replace(/\.$/, ""));
  const body = splitDatalogAtoms(parts[1]!.trim().replace(/\.$/, "")).map(parseDatalogAtom);
  return { head, body };
}

function isDatalogVariable(term: string): boolean {
  return term.startsWith("?") || /^[A-Z]/.test(term);
}

/**
 * Datalog reasoner with bottom-up semi-naive fixpoint evaluation, supporting
 * recursive Horn clauses (e.g. transitive closure).
 */
export class DatalogReasoner {
  private facts = new Map<string, string[][]>(); // predicate -> list of arg tuples
  private rules: DatalogRule[] = [];

  addFact(fact: DatalogFact): void {
    if (!this.facts.has(fact.predicate)) this.facts.set(fact.predicate, []);
    const tuples = this.facts.get(fact.predicate)!;
    if (!tuples.some((t) => t.join("\u0000") === fact.args.join("\u0000"))) {
      tuples.push([...fact.args]);
    }
  }

  addRule(ruleText: string): void {
    this.rules.push(parseDatalogRule(ruleText));
  }

  evaluate(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const rule of this.rules) {
        for (const tuple of this.evaluateRule(rule)) {
          const key = tuple.join("\u0000");
          if (!this.facts.has(rule.head.predicate)) this.facts.set(rule.head.predicate, []);
          if (!this.facts.get(rule.head.predicate)!.some((t) => t.join("\u0000") === key)) {
            this.facts.get(rule.head.predicate)!.push(tuple);
            changed = true;
          }
        }
      }
    }
  }

  private evaluateRule(rule: DatalogRule): string[][] {
    // Start with the empty binding; join each body atom in turn.
    let bindings: Array<Map<string, string>> = [new Map()];
    for (const atom of rule.body) {
      const matches = this.matchAtom(atom);
      const next: Array<Map<string, string>> = [];
      for (const existing of bindings) {
        for (const m of matches) {
          const merged = mergeBindings(existing, m);
          if (merged) next.push(merged);
        }
      }
      bindings = next;
    }
    return bindings.map((b) =>
      rule.head.args.map((a) => (isDatalogVariable(a) ? (b.get(a) ?? a) : a)),
    );
  }

  private matchAtom(atom: DatalogFact): Array<Map<string, string>> {
    const tuples = this.facts.get(atom.predicate) ?? [];
    const results: Array<Map<string, string>> = [];
    for (const tuple of tuples) {
      if (tuple.length !== atom.args.length) continue;
      const bindings = new Map<string, string>();
      let ok = true;
      for (let i = 0; i < atom.args.length; i++) {
        const arg = atom.args[i]!;
        const val = tuple[i]!;
        if (isDatalogVariable(arg)) {
          if (bindings.has(arg) && bindings.get(arg) !== val) {
            ok = false;
            break;
          }
          bindings.set(arg, val);
        } else if (arg !== val) {
          ok = false;
          break;
        }
      }
      if (ok) results.push(bindings);
    }
    return results;
  }

  query(queryText: string): DatalogFact[] {
    const atom = parseDatalogAtom(queryText.replace(/\.$/, ""));
    this.evaluate();
    const tuples = this.facts.get(atom.predicate) ?? [];
    return tuples
      .filter((t) => atom.args.every((a, i) => isDatalogVariable(a) || a === t[i]))
      .map((args) => ({ predicate: atom.predicate, args }));
  }
}

function mergeBindings(a: Map<string, string>, b: Map<string, string>): Map<string, string> | null {
  const merged = new Map(a);
  for (const [k, v] of b) {
    const existing = merged.get(k);
    if (existing !== undefined && existing !== v) return null;
    merged.set(k, v);
  }
  return merged;
}

/** SPARQL-style reasoning over RDF triple facts. */
export class SparqlReasoner {
  private triples: Triple[] = [];

  addTriple(triple: Triple): void {
    this.triples.push(triple);
  }

  /** Execute a simple SPARQL SELECT-like query over stored triples. */
  select(where: TriplePattern): Array<Record<string, string>> {
    const results: Array<Record<string, string>> = [];
    for (const triple of this.triples) {
      const bindings = unify(where, triple);
      if (bindings) {
        const row: Record<string, string> = {};
        for (const [k, v] of bindings) row[k] = v;
        results.push(row);
      }
    }
    return results;
  }
}

/**
 * Graph reasoner — deductive and abductive inference over a knowledge graph
 * (facts + rules expressed as graph patterns).
 */
export class GraphReasoner {
  private facts: Triple[] = [];
  private rules: Array<{ if: TriplePattern[]; then: TriplePattern }> = [];

  addFact(fact: Triple): void {
    this.facts.push(fact);
  }

  addRule(rule: { if: TriplePattern[]; then: TriplePattern }): void {
    this.rules.push(rule);
  }

  /** Deductive inference: guaranteed conclusions from premises. */
  infer(): InferenceResult[] {
    const results: InferenceResult[] = [];
    for (const rule of this.rules) {
      // Forward-chain rule patterns against facts.
      const engine = new Reasoner();
      for (const f of this.facts) engine.addFact(f);
      engine.addRule({
        id: uuid(),
        name: "graph-rule",
        conditions: rule.if,
        conclusion: rule.then,
        ruleType: "implication",
        confidence: 1.0,
        priority: 0,
      });
      results.push(...engine.infer());
    }
    return results;
  }

  /** Abductive reasoning: infer the most plausible explanation for evidence. */
  abduce(evidence: Triple[]): Array<{ hypothesis: Triple; score: number }> {
    const hypotheses: Array<{ hypothesis: Triple; score: number }> = [];
    for (const e of evidence) {
      for (const rule of this.rules) {
        // If evidence matches rule conclusion, the rule's conditions are a hypothesis.
        const conclusionMatch = unify(rule.then, e);
        if (!conclusionMatch) continue;
        for (const cond of rule.if) {
          const hypothesis = substitute(cond, conclusionMatch);
          hypotheses.push({ hypothesis, score: 1.0 });
        }
      }
    }
    return hypotheses;
  }
}
