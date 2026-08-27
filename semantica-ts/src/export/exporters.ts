/**
 * Export — serialize graphs to downstream formats: RDF Turtle, JSON-LD,
 * N-Triples, CSV, and Cypher.
 */
import type { GraphData } from "../types.js";

function sanitizeUri(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

export class RDFExporter {
  /** Export a graph as RDF Turtle (optionally with provenance). */
  export(graph: GraphData, format: "turtle" | "json-ld" | "nt" = "turtle"): string {
    switch (format) {
      case "turtle":
        return this.toTurtle(graph);
      case "json-ld":
        return this.toJsonLd(graph);
      case "nt":
        return this.toNTriples(graph);
      default:
        throw new Error(`Unsupported RDF format: ${format}`);
    }
  }

  private toTurtle(graph: GraphData): string {
    const lines = [
      "@prefix ex: <http://example.org/> .",
      "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
      "",
    ];
    for (const node of graph.nodes) {
      lines.push(`ex:${sanitizeUri(node.id)} rdf:type ex:${sanitizeUri(node.type)} .`);
      if (node.content && node.content !== node.id) {
        lines.push(`ex:${sanitizeUri(node.id)} ex:label "${escapeLiteral(node.content)}" .`);
      }
      for (const [k, v] of Object.entries(node.properties)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          lines.push(`ex:${sanitizeUri(node.id)} ex:${sanitizeUri(k)} "${escapeLiteral(String(v))}" .`);
        }
      }
    }
    for (const edge of graph.edges) {
      lines.push(
        `ex:${sanitizeUri(edge.source_id)} ex:${sanitizeUri(edge.type)} ex:${sanitizeUri(edge.target_id)} .`,
      );
    }
    return lines.join("\n");
  }

  private toNTriples(graph: GraphData): string {
    const lines: string[] = [];
    for (const edge of graph.edges) {
      lines.push(
        `<http://example.org/${sanitizeUri(edge.source_id)}> <http://example.org/${sanitizeUri(edge.type)}> <http://example.org/${sanitizeUri(edge.target_id)}> .`,
      );
    }
    return lines.join("\n");
  }

  private toJsonLd(graph: GraphData): string {
    const doc = {
      "@context": { ex: "http://example.org/" },
      "@graph": [
        ...graph.nodes.map((n) => ({
          "@id": `ex:${sanitizeUri(n.id)}`,
          "@type": `ex:${sanitizeUri(n.type)}`,
          "ex:label": n.content,
          ...Object.fromEntries(
            Object.entries(n.properties)
              .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
              .map(([k, v]) => [`ex:${sanitizeUri(k)}`, v]),
          ),
        })),
        ...graph.edges.map((e) => ({
          "@id": `ex:edge_${sanitizeUri(e.id)}`,
          "ex:source": { "@id": `ex:${sanitizeUri(e.source_id)}` },
          "ex:type": `ex:${sanitizeUri(e.type)}`,
          "ex:target": { "@id": `ex:${sanitizeUri(e.target_id)}` },
        })),
      ],
    };
    return JSON.stringify(doc, null, 2);
  }
}

export class CSVExporter {
  /** Export nodes and edges as CSV strings. */
  export(graph: GraphData): { nodes: string; edges: string } {
    const nodeHeader = ["id", "type", "content"];
    const nodeRows = graph.nodes.map((n) =>
      [n.id, n.type, n.content].map(csvEscape).join(","),
    );
    const edgeHeader = ["id", "source_id", "target_id", "type", "weight"];
    const edgeRows = graph.edges.map((e) =>
      [e.id, e.source_id, e.target_id, e.type, String(e.weight)].map(csvEscape).join(","),
    );
    return {
      nodes: [nodeHeader.join(","), ...nodeRows].join("\n"),
      edges: [edgeHeader.join(","), ...edgeRows].join("\n"),
    };
  }
}

export class CypherExporter {
  /** Export a graph as Cypher CREATE statements for Neo4j / FalkorDB. */
  export(graph: GraphData): string {
    const lines: string[] = [];
    for (const node of graph.nodes) {
      lines.push(
        `CREATE (n:${sanitizeUri(node.type)} {id: "${escapeCypher(node.id)}", content: "${escapeCypher(node.content)}"});`,
      );
    }
    for (const edge of graph.edges) {
      lines.push(
        `MATCH (a {id: "${escapeCypher(edge.source_id)}"}), (b {id: "${escapeCypher(edge.target_id)}"}) CREATE (a)-[:${sanitizeUri(edge.type)} {weight: ${edge.weight}}]->(b);`,
      );
    }
    return lines.join("\n");
  }
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeCypher(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
