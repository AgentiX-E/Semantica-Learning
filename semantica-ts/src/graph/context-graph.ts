/**
 * ContextGraph — the core data structure of semantica.
 *
 * An in-memory graph store for building and querying context graphs, with:
 *   - entity / relationship storage with typed indexes
 *   - BFS neighbor discovery with hop-distance metadata
 *   - temporal validity windows and point-in-time snapshots (`state_at`)
 *   - JSON serialization (save/load)
 *   - decision intelligence delegation
 *   - graph analytics (centrality, communities, path finding, similarity)
 */
import { DecisionEngine } from "../decisions/decision-engine.js";
import {
  buildAdjacency,
  computeCentrality,
  commonNeighbors,
  detectCommunities,
  dijkstraShortestPath,
  modularity,
  nodeSimilarity,
} from "../analytics/index.js";
import type {
  CentralityKind,
} from "../analytics/index.js";
import type {
  CrossGraphLink,
  GraphData,
  GraphEdge,
  GraphNode,
  Properties,
} from "../types.js";
import {
  classifyPathDistance,
  coerceFloat,
  coerceMetadataMap,
  isActive,
  pickFirst,
  uuid,
  uuidFor,
} from "../utils.js";

export interface ContextGraphConfig {
  advancedAnalytics?: boolean;
  centralityAnalysis?: boolean;
  communityDetection?: boolean;
  nodeEmbeddings?: boolean;
  [key: string]: unknown;
}

export interface NeighborEntry {
  id: string;
  type: string;
  content: string;
  relationship: string;
  weight: number;
  hop: number;
  distance_band?: string;
  confidence_decay?: number;
  path_to_anchor?: string[];
}

/** Coerce a raw node dict into a canonical GraphNode. */
function coerceNode(raw: Record<string, any>): GraphNode | null {
  const id = pickFirst(raw.id, raw.node_id, raw._id, raw.uri, raw.key);
  if (id === null) return null;
  const nodeId = String(id).trim();
  if (!nodeId) return null;

  const props = coerceMetadataMap(raw.metadata, raw.properties);
  const type = pickFirst(
    raw.type,
    raw.node_type,
    raw.category,
    raw[":LABEL"],
    props.type,
  ) ?? "entity";
  const content = pickFirst(
    raw.content,
    raw.text,
    raw.label,
    raw.name,
    raw.title,
    raw.pref_label,
    props.content,
    props.text,
    props.label,
    props.name,
    props.title,
    props.pref_label,
    nodeId,
  ) ?? nodeId;

  const validFrom = pickFirst(raw.valid_from, props.valid_from) as string | null;
  const validUntil = pickFirst(raw.valid_until, props.valid_until) as string | null;
  const metadata: Properties = Object.fromEntries(
    Object.entries(props).filter(([k]) => !["content", "text", "valid_from", "valid_until"].includes(k)),
  );

  return {
    id: nodeId,
    type: String(type || "entity"),
    content: String(content),
    properties: { ...props },
    metadata,
    validFrom: validFrom ?? null,
    validUntil: validUntil ?? null,
  };
}

function coerceEdgeEndpoint(raw: Record<string, any>, prefix: "source" | "target"): string | null {
  const candidates =
    prefix === "source"
      ? ["source_id", "source", "start", "start_id", "from", "src", "START_ID", ":START_ID"]
      : ["target_id", "target", "end", "end_id", "to", "dst", "END_ID", ":END_ID"];
  const value = pickFirst(...candidates.map((c) => raw[c]));
  if (value === null) return null;
  const text = String(value).trim();
  return text || null;
}

export class ContextGraph {
  readonly graphId: string;
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];
  private readonly edgeIndex = new Map<string, GraphEdge>();
  private readonly adjacency = new Map<string, GraphEdge[]>();
  private readonly nodeTypeIndex = new Map<string, Set<string>>();
  private readonly edgeTypeIndex = new Map<string, GraphEdge[]>();
  private linkedGraphs = new Map<string, CrossGraphLink>();
  private readonly retractions = new Map<string, Properties>();
  private readonly tombstones = new Map<string, Properties>();
  private readonly config: ContextGraphConfig;

  readonly decisions: DecisionEngine;

  constructor(config: ContextGraphConfig = {}) {
    this.config = {
      advancedAnalytics: true,
      centralityAnalysis: true,
      communityDetection: true,
      nodeEmbeddings: true,
      ...config,
    };
    this.graphId = uuid();
    this.decisions = new DecisionEngine({
      hasNode: (id) => this.nodes.has(id),
      getNodeType: (id) => this.nodes.get(id)?.type,
      addNodeInternal: (node) => this.addNodeInternal(node),
      addEdgeInternal: (edge) => this.addEdgeInternal(edge),
      getEdges: () => this.edges,
    });
  }

  // ── Node / edge creation ────────────────────────────────────────────────

  private addNodeInternal(node: GraphNode): boolean {
    if (this.nodes.has(node.id)) {
      // Merge properties into existing node (idempotent re-add).
      const existing = this.nodes.get(node.id)!;
      Object.assign(existing.properties, node.properties);
      Object.assign(existing.metadata, node.metadata);
      if (node.validFrom) existing.validFrom = node.validFrom;
      if (node.validUntil) existing.validUntil = node.validUntil;
      return false;
    }
    this.nodes.set(node.id, node);
    if (!this.nodeTypeIndex.has(node.type)) this.nodeTypeIndex.set(node.type, new Set());
    this.nodeTypeIndex.get(node.type)!.add(node.id);
    if (!this.adjacency.has(node.id)) this.adjacency.set(node.id, []);
    return true;
  }

  private addEdgeInternal(edge: GraphEdge): boolean {
    if (this.edgeIndex.has(edge.id)) return false;
    this.edges.push(edge);
    this.edgeIndex.set(edge.id, edge);
    if (!this.adjacency.has(edge.source_id)) this.adjacency.set(edge.source_id, []);
    this.adjacency.get(edge.source_id)!.push(edge);
    if (!this.edgeTypeIndex.has(edge.type)) this.edgeTypeIndex.set(edge.type, []);
    this.edgeTypeIndex.get(edge.type)!.push(edge);
    return true;
  }

  addNode(nodeId: string, nodeType: string, content?: string, properties: Properties = {}): boolean {
    return this.addNodeInternal({
      id: String(nodeId),
      type: String(nodeType || "entity"),
      content: content ?? nodeId,
      properties: { ...properties },
      metadata: { ...properties },
      validFrom: (properties.valid_from as string) ?? null,
      validUntil: (properties.valid_until as string) ?? null,
    });
  }

  addEdge(
    sourceId: string,
    targetId: string,
    edgeType = "related_to",
    weight = 1.0,
    properties: Properties = {},
  ): boolean {
    const edgeId = uuidFor(
      JSON.stringify({ source: sourceId, target: targetId, type: edgeType, weight }),
    );
    return this.addEdgeInternal({
      id: edgeId,
      familyId: edgeId,
      source_id: String(sourceId),
      target_id: String(targetId),
      type: String(edgeType || "related_to"),
      weight: coerceFloat(weight),
      properties: { ...properties },
      validFrom: (properties.valid_from as string) ?? null,
      validUntil: (properties.valid_until as string) ?? null,
    });
  }

  addNodes(rawNodes: Array<Record<string, any>>): number {
    let count = 0;
    for (const raw of rawNodes) {
      if (!raw || typeof raw !== "object") continue;
      const node = coerceNode(raw);
      if (!node) continue;
      if (this.addNodeInternal(node)) count++;
    }
    return count;
  }

  addEdges(rawEdges: Array<Record<string, any>>): number {
    let count = 0;
    for (const raw of rawEdges) {
      if (!raw || typeof raw !== "object") continue;
      const sourceId = coerceEdgeEndpoint(raw, "source");
      const targetId = coerceEdgeEndpoint(raw, "target");
      if (sourceId === null || targetId === null) continue;
      const props = coerceMetadataMap(raw.metadata, raw.properties);
      const type = pickFirst(
        raw.type,
        raw.edge_type,
        raw.relationship,
        raw.predicate,
        raw.relation,
        raw[":TYPE"],
        props.type,
      ) ?? "related_to";
      const weight = coerceFloat(pickFirst(raw.weight, props.weight), 1.0);
      const explicitId = pickFirst(raw.id, raw.edge_id, props.id, props.edge_id) as string | null;
      const explicitFamilyId = pickFirst(raw.familyId, raw.family_id) as string | null;
      const edgeId =
        explicitId ??
        uuidFor(
          JSON.stringify({
            source: sourceId,
            target: targetId,
            type,
            weight,
            valid_from: raw.valid_from ?? null,
            valid_until: raw.valid_until ?? null,
          }),
        );
      const edge: GraphEdge = {
        id: String(edgeId),
        familyId: String(explicitFamilyId ?? edgeId),
        source_id: sourceId,
        target_id: targetId,
        type: String(type || "related_to"),
        weight,
        properties: { ...props },
        validFrom: (raw.valid_from as string) ?? (props.valid_from as string) ?? null,
        validUntil: (raw.valid_until as string) ?? (props.valid_until as string) ?? null,
      };
      if (this.addEdgeInternal(edge)) count++;
    }
    return count;
  }

  // ── Lookup ──────────────────────────────────────────────────────────────

  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  getNodesByLabel(label: string): GraphNode[] {
    const ids = this.nodeTypeIndex.get(label) ?? new Set();
    const result: GraphNode[] = [];
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  getNodeProperty(nodeId: string, propertyName: string, defaultValue: any = null): any {
    const node = this.nodes.get(nodeId);
    if (!node) return defaultValue;
    return node.properties[propertyName] ?? defaultValue;
  }

  getNodeAttributes(nodeId: string): Properties {
    return { ...(this.nodes.get(nodeId)?.properties ?? {}) };
  }

  addNodeAttribute(nodeId: string, attributes: Properties): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    Object.assign(node.properties, attributes);
    Object.assign(node.metadata, attributes);
    if (node.type.toLowerCase() === "decision") {
      this.decisions.rebuildFromNodes(() => [...this.nodes.values()]);
    }
  }

  getEdgeData(sourceId: string, targetId: string): Properties {
    for (const edge of this.adjacency.get(sourceId) ?? []) {
      if (edge.target_id === targetId) {
        return {
          id: edge.id,
          familyId: edge.familyId,
          type: edge.type,
          weight: edge.weight,
          ...edge.properties,
        };
      }
    }
    return {};
  }

  getNeighborIds(nodeId: string, relationshipTypes?: string[]): string[] {
    if (!this.nodes.has(nodeId)) return [];
    const filter = relationshipTypes ? new Set(relationshipTypes) : null;
    const result: string[] = [];
    for (const edge of this.adjacency.get(nodeId) ?? []) {
      if (filter === null || filter.has(edge.type)) result.push(edge.target_id);
    }
    return result;
  }

  // ── Traversal ───────────────────────────────────────────────────────────

  getNeighbors(
    nodeId: string,
    hops = 1,
    relationshipTypes?: string[],
    minWeight = 0.0,
    skip = 0,
    limit?: number,
    includeDistanceMetadata = false,
  ): NeighborEntry[] {
    if (!this.nodes.has(nodeId)) return [];
    const neighbors: NeighborEntry[] = [];
    const visited = new Set([nodeId]);
    const queue: Array<[string, number, string[], number]> = [[nodeId, 0, [nodeId], 1.0]];
    const filter = relationshipTypes ? new Set(relationshipTypes) : null;

    while (queue.length) {
      const [currentId, currentHop, pathSoFar, decaySoFar] = queue.shift()!;
      if (currentHop >= hops) continue;
      for (const edge of this.adjacency.get(currentId) ?? []) {
        if (filter !== null && !filter.has(edge.type)) continue;
        if (edge.weight < minWeight) continue;
        const neighborId = edge.target_id;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        const nextHop = currentHop + 1;
        const nextDecay = decaySoFar * edge.weight;
        const nextPath = [...pathSoFar, neighborId];
        queue.push([neighborId, nextHop, nextPath, nextDecay]);

        const node = this.nodes.get(neighborId);
        if (!node) continue;
        const entry: NeighborEntry = {
          id: node.id,
          type: node.type,
          content: node.content,
          relationship: edge.type,
          weight: edge.weight,
          hop: nextHop,
        };
        if (includeDistanceMetadata) {
          entry.distance_band = classifyPathDistance(nextHop);
          entry.confidence_decay = nextDecay;
          entry.path_to_anchor = nextPath;
        }
        neighbors.push(entry);
      }
    }
    if (limit !== undefined) return neighbors.slice(skip, skip + limit);
    return neighbors.slice(skip);
  }

  getNeighborDistances(
    nodeId: string,
    hops = 3,
    relationshipTypes?: string[],
    minConfidence = 0.0,
  ): NeighborEntry[] {
    const neighbors = this.getNeighbors(nodeId, hops, relationshipTypes, 0, 0, undefined, true);
    return neighbors
      .filter((n) => (n.confidence_decay ?? 0) >= minConfidence)
      .sort((a, b) => a.hop - b.hop || (b.confidence_decay ?? 0) - (a.confidence_decay ?? 0));
  }

  query(query: string, skip = 0, limit?: number): Array<{ node: GraphNode; score: number; content: string }> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: Array<{ node: GraphNode; score: number; content: string }> = [];
    for (const node of this.nodes.values()) {
      const contentLower = node.content.toLowerCase();
      const overlap = words.filter((w) => contentLower.includes(w)).length;
      if (overlap > 0) {
        results.push({
          node,
          score: words.length ? overlap / words.length : 0,
          content: node.content,
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    if (limit !== undefined) return results.slice(skip, skip + limit);
    return results.slice(skip);
  }

  // ── Temporal ────────────────────────────────────────────────────────────

  /** Return the graph state (active nodes/edges) at a point in time. */
  stateAt(at: string | Date): GraphData {
    const atDate = at instanceof Date ? at : new Date(at);
    const nodes = [...this.nodes.values()].filter((n) =>
      isActive(n.validFrom, n.validUntil, atDate),
    );
    const edges = this.edges.filter((e) =>
      isActive(e.validFrom, e.validUntil, atDate),
    );
    return { graph_id: this.graphId, nodes, edges };
  }

  retractNode(nodeId: string, atIso: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.validUntil = closingValidUntilFor(node.validUntil, atIso);
  }

  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    this.nodes.delete(nodeId);
    this.nodeTypeIndex.get(node.type)?.delete(nodeId);
    this.tombstones.set(`node:${nodeId}`, { purged_at: new Date().toISOString() });
    return true;
  }

  // ── Analytics ───────────────────────────────────────────────────────────

  private adjacencyView() {
    return buildAdjacency(
      [...this.nodes.keys()],
      this.edges,
    );
  }

  getNodeCentrality(nodeId: string, kinds?: CentralityKind[]): Record<string, number> {
    const adj = this.adjacencyView();
    const allKinds: CentralityKind[] = kinds ?? [
      "degree",
      "in_degree",
      "out_degree",
      "betweenness",
      "closeness",
      "pagerank",
    ];
    const centralities = computeCentrality(adj, allKinds);
    const result: Record<string, number> = {};
    for (const kind of allKinds) {
      result[kind] = centralities[kind]?.[nodeId] ?? 0;
    }
    return result;
  }

  analyzeGraphWithKg(): {
    node_count: number;
    edge_count: number;
    density: number;
    communities: Record<string, number>;
    modularity: number;
  } {
    const adj = this.adjacencyView();
    const n = this.nodes.size;
    const m = this.edges.length;
    const communities = detectCommunities(adj);
    return {
      node_count: n,
      edge_count: m,
      density: n > 1 ? (2 * m) / (n * (n - 1)) : 0,
      communities,
      modularity: modularity(adj, communities),
    };
  }

  findShortestPath(sourceId: string, targetId: string): { path: string[]; cost: number } | null {
    return dijkstraShortestPath(this.adjacencyView(), sourceId, targetId);
  }

  linkPredictionScore(a: string, b: string): number {
    return commonNeighbors(this.adjacencyView(), a, b);
  }

  findSimilarNodes(
    nodeId: string,
    embeddings: Map<string, number[]> = new Map(),
  ): Array<{ id: string; score: number }> {
    const anchor = embeddings.get(nodeId);
    if (!anchor) return [];
    const scored: Array<{ id: string; score: number }> = [];
    for (const [id, vec] of embeddings) {
      if (id === nodeId) continue;
      scored.push({ id, score: nodeSimilarity(anchor, vec) });
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  // ── Serialization ───────────────────────────────────────────────────────

  toKgDict(): GraphData {
    return {
      graph_id: this.graphId,
      nodes: [...this.nodes.values()],
      edges: [...this.edges],
      links: [...this.linkedGraphs.values()],
    };
  }

  saveToFile(path: string, format: "json" = "json"): void {
    if (format !== "json") throw new Error("Only JSON format is supported by saveToFile");
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(path, JSON.stringify(this.toKgDict(), null, 2), "utf-8");
  }

  loadFromFile(path: string, format: "json" = "json"): void {
    if (format !== "json") throw new Error("Only JSON format is supported by loadFromFile");
    const fs = require("node:fs") as typeof import("node:fs");
    const data = JSON.parse(fs.readFileSync(path, "utf-8"));
    this.loadData(data);
  }

  loadData(data: GraphData | Record<string, any>): void {
    this.nodes.clear();
    this.edges.length = 0;
    this.edgeIndex.clear();
    this.adjacency.clear();
    this.nodeTypeIndex.clear();
    this.edgeTypeIndex.clear();
    this.linkedGraphs.clear();
    this.retractions.clear();
    this.tombstones.clear();

    if (typeof data === "object" && data !== null && "graph_id" in data) {
      (this as any).graphId = (data as any).graph_id;
    }
    const nodes = (data as any).nodes ?? (data as any).entities ?? (data as any).vertices ?? [];
    const edges = (data as any).edges ?? (data as any).relationships ?? (data as any).links ?? [];
    this.addNodes(nodes);
    this.addEdges(edges);
    for (const link of (data as any).links ?? []) {
      if (link.link_id) this.linkedGraphs.set(link.link_id, link);
    }
    this.decisions.rebuildFromNodes(() => [...this.nodes.values()]);
  }
}

function closingValidUntilFor(current: string | null | undefined, atIso: string): string {
  if (current === null || current === undefined) return atIso;
  const existing = new Date(current).getTime();
  const requested = new Date(atIso).getTime();
  if (Number.isNaN(existing) || existing <= requested) return current;
  return atIso;
}

export { classifyPathDistance };
