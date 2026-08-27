/**
 * Ontology — schema management: classes, relationships, rules, SHACL shapes,
 * OWL generation, and SKOS vocabularies.
 */

export interface OntologySpec {
  classes: string[];
  relationships: string[];
  rules?: Record<string, string[]>;
  subclassOf?: Record<string, string>;
}

export interface SHACLShape {
  targetClass: string;
  properties: Array<{
    path: string;
    minCount?: number;
    maxCount?: number;
    datatype?: string;
  }>;
}

export class OntologyGenerator {
  /** Generate an ontology spec from a knowledge graph. */
  generateFromGraph(entities: Array<{ type: string }>, relationships: Array<{ type: string }>): OntologySpec {
    const classes = [...new Set(entities.map((e) => e.type))].sort();
    const rels = [...new Set(relationships.map((r) => r.type))].sort();
    const rules: Record<string, string[]> = {};
    for (const cls of classes) {
      rules[cls] = ["must_have_name"];
    }
    return { classes, relationships: rels, rules };
  }
}

export class SHACLGenerator {
  /** Generate SHACL shapes from an ontology spec. */
  generate(ontology: OntologySpec): SHACLShape[] {
    return ontology.classes.map((cls) => ({
      targetClass: cls,
      properties: [{ path: "name", minCount: 1 }],
    }));
  }

  /** Validate a node against SHACL shapes. */
  validate(
    shapes: SHACLShape[],
    nodes: Array<{ type: string; properties: Record<string, unknown> }>,
  ): Array<{ node: string; shape: string; violations: string[] }> {
    const results: Array<{ node: string; shape: string; violations: string[] }> = [];
    for (const node of nodes) {
      const shape = shapes.find((s) => s.targetClass === node.type);
      if (!shape) continue;
      const violations: string[] = [];
      for (const prop of shape.properties) {
        const value = node.properties[prop.path];
        if (prop.minCount !== undefined && (value === undefined || value === null || value === "")) {
          violations.push(`Missing required property '${prop.path}'`);
        }
      }
      if (violations.length) {
        results.push({ node: node.type, shape: shape.targetClass, violations });
      }
    }
    return results;
  }
}

export class OWLGenerator {
  /** Generate a simple OWL/RDF Turtle document from an ontology spec. */
  generate(ontology: OntologySpec): string {
    const lines = [
      "@prefix owl: <http://www.w3.org/2002/07/owl#> .",
      "@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .",
      "@prefix ex: <http://example.org/ontology#> .",
      "",
      "ex:Ontology a owl:Ontology .",
      "",
    ];
    for (const cls of ontology.classes) {
      lines.push(`ex:${sanitize(cls)} a owl:Class ; rdfs:label "${cls}" .`);
    }
    for (const rel of ontology.relationships) {
      lines.push(`ex:${sanitize(rel)} a owl:ObjectProperty .`);
    }
    if (ontology.subclassOf) {
      for (const [child, parent] of Object.entries(ontology.subclassOf)) {
        lines.push(`ex:${sanitize(child)} rdfs:subClassOf ex:${sanitize(parent)} .`);
      }
    }
    return lines.join("\n");
  }
}

/** SKOS vocabulary management. */
export class SKOSVocabulary {
  private concepts = new Map<string, { prefLabel: string; broader?: string; narrower: string[] }>();

  addConcept(id: string, prefLabel: string, broader?: string): void {
    this.concepts.set(id, { prefLabel, broader, narrower: [] });
    if (broader) {
      const parent = this.concepts.get(broader);
      if (parent) parent.narrower.push(id);
    }
  }

  /** Export the vocabulary as SKOS RDF. */
  toTurtle(): string {
    const lines = [
      "@prefix skos: <http://www.w3.org/2004/02/skos/core#> .",
      "@prefix ex: <http://example.org/vocab#> .",
      "",
    ];
    for (const [id, c] of this.concepts) {
      lines.push(`ex:${sanitize(id)} a skos:Concept ; skos:prefLabel "${c.prefLabel}" .`);
      if (c.broader) lines.push(`ex:${sanitize(id)} skos:broader ex:${sanitize(c.broader)} .`);
      for (const n of c.narrower) lines.push(`ex:${sanitize(id)} skos:narrower ex:${sanitize(n)} .`);
    }
    return lines.join("\n");
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
