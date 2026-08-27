/**
 * Graph analytics — centrality, community detection, path finding,
 * link prediction, and node similarity.
 *
 * These are pure functions over an adjacency representation so they can be
 * reused by `ContextGraph` without creating circular imports.
 */
import type { GraphEdge } from "../types.js";
import { cosineSimilarity } from "../utils.js";

export interface Adjacency {
  /** nodeId -> outgoing edges */
  out: Map<string, GraphEdge[]>;
  /** nodeId -> incoming edges */
  in: Map<string, GraphEdge[]>;
  /** all node ids */
  nodes: Set<string>;
}

/** Build an adjacency representation from a list of nodes and edges. */
export function buildAdjacency(nodes: string[], edges: GraphEdge[]): Adjacency {
  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const id of nodes) {
    out.set(id, []);
    inc.set(id, []);
  }
  for (const e of edges) {
    if (!out.has(e.source_id)) out.set(e.source_id, []);
    if (!out.has(e.target_id)) out.set(e.target_id, []);
    if (!inc.has(e.source_id)) inc.set(e.source_id, []);
    if (!inc.has(e.target_id)) inc.set(e.target_id, []);
    out.get(e.source_id)!.push(e);
    inc.get(e.target_id)!.push(e);
  }
  return { out, in: inc, nodes: new Set(nodes) };
}

export type CentralityKind =
  | "degree"
  | "in_degree"
  | "out_degree"
  | "betweenness"
  | "closeness"
  | "eigenvector"
  | "pagerank";

export interface CentralityResult {
  [kind: string]: Record<string, number>;
}

/** Compute the requested centrality measures for every node. */
export function computeCentrality(
  adj: Adjacency,
  kinds: CentralityKind[] = ["degree", "betweenness", "closeness", "pagerank"],
): CentralityResult {
  const result: CentralityResult = {};
  const nodeList = [...adj.nodes];
  for (const kind of kinds) {
    result[kind] = centralityFor(adj, kind, nodeList);
  }
  return result;
}

function centralityFor(
  adj: Adjacency,
  kind: CentralityKind,
  nodes: string[],
): Record<string, number> {
  const scores: Record<string, number> = {};
  switch (kind) {
    case "degree":
      for (const n of nodes) {
        scores[n] = (adj.out.get(n)?.length ?? 0) + (adj.in.get(n)?.length ?? 0);
      }
      return scores;
    case "in_degree":
      for (const n of nodes) scores[n] = adj.in.get(n)?.length ?? 0;
      return scores;
    case "out_degree":
      for (const n of nodes) scores[n] = adj.out.get(n)?.length ?? 0;
      return scores;
    case "betweenness":
      return betweennessCentrality(adj, nodes);
    case "closeness":
      return closenessCentrality(adj, nodes);
    case "eigenvector":
      return eigenvectorCentrality(adj, nodes);
    case "pagerank":
      return pagerank(adj, nodes);
    default:
      return scores;
  }
}

function betweennessCentrality(adj: Adjacency, nodes: string[]): Record<string, number> {
  const scores: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, 0]));
  for (const s of nodes) {
    // Brandes' algorithm (unweighted).
    const stack: string[] = [];
    const pred = new Map<string, string[]>(nodes.map((n) => [n, []]));
    const sigma = new Map<string, number>(nodes.map((n) => [n, 0]));
    const dist = new Map<string, number>(nodes.map((n) => [n, -1]));
    sigma.set(s, 1);
    dist.set(s, 0);
    const queue: string[] = [s];
    while (queue.length) {
      const v = queue.shift()!;
      stack.push(v);
      for (const edge of adj.out.get(v) ?? []) {
        const w = edge.target_id;
        if (dist.get(w)! < 0) {
          dist.set(w, dist.get(v)! + 1);
          queue.push(w);
        }
        if (dist.get(w)! === dist.get(v)! + 1) {
          sigma.set(w, sigma.get(w)! + sigma.get(v)!);
          pred.get(w)!.push(v);
        }
      }
    }
    const delta = new Map<string, number>(nodes.map((n) => [n, 0]));
    while (stack.length) {
      const w = stack.pop()!;
      for (const v of pred.get(w) ?? []) {
        delta.set(v, delta.get(v)! + (sigma.get(v)! / sigma.get(w)!) * (1 + delta.get(w)!));
      }
      if (w !== s) scores[w] = (scores[w] ?? 0) + delta.get(w)!;
    }
  }
  return scores;
}

function closenessCentrality(adj: Adjacency, nodes: string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const s of nodes) {
    const dist = bfsDistances(adj, s, nodes);
    const reachable = Object.values(dist).filter((d) => d > 0);
    const sum = reachable.reduce((a, b) => a + b, 0);
    if (reachable.length === 0 || sum === 0) {
      scores[s] = 0;
    } else {
      scores[s] = reachable.length / sum;
    }
  }
  return scores;
}

function eigenvectorCentrality(adj: Adjacency, nodes: string[]): Record<string, number> {
  let x = Object.fromEntries(nodes.map((n) => [n, 1]));
  const order = nodes;
  const index = new Map(order.map((n, i) => [n, i]));
  for (let iter = 0; iter < 100; iter++) {
    const next: Record<string, number> = {};
    for (const n of order) {
      let sum = 0;
      for (const e of adj.in.get(n) ?? []) {
        sum += x[e.source_id] ?? 0;
      }
      next[n] = sum;
    }
    const norm = Math.sqrt(Object.values(next).reduce((a, b) => a + b * b, 0)) || 1;
    for (const n of order) next[n] = (next[n] ?? 0) / norm;
    let delta = 0;
    for (const n of order) delta += Math.abs((next[n] ?? 0) - (x[n] ?? 0));
    x = next;
    if (delta < 1e-10) break;
  }
  return x;
}

function pagerank(adj: Adjacency, nodes: string[], damping = 0.85): Record<string, number> {
  const N = nodes.length;
  if (N === 0) return {};
  let rank = Object.fromEntries(nodes.map((n) => [n, 1 / N]));
  for (let iter = 0; iter < 100; iter++) {
    const next: Record<string, number> = {};
    for (const n of nodes) {
      let sum = 0;
      for (const e of adj.in.get(n) ?? []) {
        const outDeg = adj.out.get(e.source_id)?.length ?? 0;
        sum += (rank[e.source_id] ?? 0) / (outDeg || 1);
      }
      next[n] = (1 - damping) / N + damping * sum;
    }
    let delta = 0;
    for (const n of nodes) delta += Math.abs((next[n] ?? 0) - (rank[n] ?? 0));
    rank = next;
    if (delta < 1e-10) break;
  }
  return rank;
}

function bfsDistances(adj: Adjacency, source: string, nodes: string[]): Record<string, number> {
  const dist: Record<string, number> = Object.fromEntries(nodes.map((n) => [n, -1]));
  dist[source] = 0;
  const queue = [source];
  while (queue.length) {
    const v = queue.shift()!;
    for (const e of adj.out.get(v) ?? []) {
      if (dist[e.target_id] === -1) {
        dist[e.target_id] = dist[v]! + 1;
        queue.push(e.target_id);
      }
    }
  }
  return dist;
}

/** Dijkstra shortest path (weighted by edge weight as cost = 1/weight). */
export function dijkstraShortestPath(
  adj: Adjacency,
  source: string,
  target: string,
): { path: string[]; cost: number } | null {
  if (!adj.nodes.has(source) || !adj.nodes.has(target)) return null;
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  for (const n of adj.nodes) dist.set(n, Infinity);
  dist.set(source, 0);

  while (visited.size < adj.nodes.size) {
    let u: string | null = null;
    let best = Infinity;
    for (const n of adj.nodes) {
      if (!visited.has(n) && (dist.get(n) ?? Infinity) < best) {
        best = dist.get(n)!;
        u = n;
      }
    }
    if (u === null || best === Infinity) break;
    visited.add(u);
    if (u === target) break;
    for (const e of adj.out.get(u) ?? []) {
      const cost = 1 / Math.max(e.weight, 1e-9);
      const alt = (dist.get(u) ?? Infinity) + cost;
      if (alt < (dist.get(e.target_id) ?? Infinity)) {
        dist.set(e.target_id, alt);
        prev.set(e.target_id, u);
      }
    }
  }

  if ((dist.get(target) ?? Infinity) === Infinity) return null;
  const path: string[] = [];
  let cur: string | undefined = target;
  while (cur !== undefined) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return { path, cost: dist.get(target)! };
}

/** Louvain-style modularity community detection (simplified). */
export function detectCommunities(adj: Adjacency, iterations = 20): Record<string, number> {
  const communities = new Map<string, number>();
  [...adj.nodes].forEach((n, i) => communities.set(n, i));

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (const node of adj.nodes) {
      const neighborCounts = new Map<number, number>();
      for (const e of [...(adj.out.get(node) ?? []), ...(adj.in.get(node) ?? [])]) {
        const other = e.source_id === node ? e.target_id : e.source_id;
        const c = communities.get(other)!;
        neighborCounts.set(c, (neighborCounts.get(c) ?? 0) + 1);
      }
      if (neighborCounts.size === 0) continue;
      let best = communities.get(node)!;
      let bestGain = 0;
      for (const [c, count] of neighborCounts) {
        if (c === communities.get(node)) continue;
        if (count > bestGain) {
          bestGain = count;
          best = c;
        }
      }
      if (best !== communities.get(node)) {
        communities.set(node, best);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return Object.fromEntries(communities);
}

/** Compute the modularity Q of a community assignment. */
export function modularity(
  adj: Adjacency,
  communities: Record<string, number>,
): number {
  const m = [...adj.out.values()].reduce((sum, edges) => sum + edges.length, 0);
  if (m === 0) return 0;
  let q = 0;
  for (const [u, edges] of adj.out) {
    for (const e of edges) {
      if (communities[u] === communities[e.target_id]) {
        const ku = (adj.out.get(u)?.length ?? 0);
        const kv = (adj.in.get(e.target_id)?.length ?? 0);
        q += 1 - (ku * kv) / (2 * m);
      }
    }
  }
  return q / (2 * m);
}

/** Link prediction via common-neighbors score between two nodes. */
export function commonNeighbors(adj: Adjacency, a: string, b: string): number {
  const na = new Set((adj.out.get(a) ?? []).map((e) => e.target_id));
  const nb = new Set((adj.out.get(b) ?? []).map((e) => e.target_id));
  let count = 0;
  for (const n of na) if (nb.has(n)) count++;
  return count;
}

/** Content similarity between two nodes using their embeddings. */
export function nodeSimilarity(
  aEmbedding: number[] | undefined,
  bEmbedding: number[] | undefined,
): number {
  if (!aEmbedding || !bEmbedding) return 0;
  return cosineSimilarity(aEmbedding, bEmbedding);
}
