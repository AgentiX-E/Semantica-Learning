/**
 * Provenance — W3C PROV-O compliant lineage tracking.
 *
 * Every fact/entity in semantica links back to its source document, extraction
 * method, timestamp, and checksum.
 */
import type { ProvenanceRecord } from "../types.js";
import { sha256 } from "../utils.js";

export class ProvenanceManager {
  private records = new Map<string, ProvenanceRecord[]>();

  /** Track the lineage of an entity. */
  trackEntity(
    entity: string,
    source: string,
    metadata: { location?: string | null; method?: string; confidence?: number } = {},
  ): void {
    const record: ProvenanceRecord = {
      entity,
      source,
      location: metadata.location ?? null,
      timestamp: new Date().toISOString(),
      method: metadata.method ?? "unknown",
      confidence: metadata.confidence,
      checksum: sha256(source + entity),
    };
    if (!this.records.has(entity)) this.records.set(entity, []);
    this.records.get(entity)!.push(record);
  }

  /** Get full lineage for an entity (most recent first). */
  getLineage(entity: string): ProvenanceRecord[] {
    return [...(this.records.get(entity) ?? [])].reverse();
  }

  /** Get every source that contributed to an entity. */
  getAllSources(entity: string): Array<{
    source: string;
    location: string | null;
    timestamp: string;
    confidence?: number;
  }> {
    return this.getLineage(entity).map((r) => ({
      source: r.source,
      location: r.location ?? null,
      timestamp: r.timestamp,
      confidence: r.confidence,
    }));
  }

  /** Export lineage as a PROV-O-like RDF/Turtle document. */
  toProvoTurtle(): string {
    const lines: string[] = [
      "@prefix prov: <http://www.w3.org/ns/prov#> .",
      "@prefix ex: <http://example.org/> .",
      "",
    ];
    let i = 0;
    for (const [entity, records] of this.records) {
      const entityUri = `ex:${sanitize(entity)}`;
      for (const r of records) {
        const activity = `ex:activity${++i}`;
        lines.push(`${entityUri} prov:wasDerivedFrom ex:${sanitize(r.source)} .`);
        lines.push(`${entityUri} prov:wasGeneratedBy ${activity} .`);
        lines.push(`${activity} a prov:Activity ; prov:endedAtTime "${r.timestamp}" .`);
        if (r.method) lines.push(`${activity} prov:used ex:${sanitize(r.method)} .`);
        lines.push("");
      }
    }
    return lines.join("\n");
  }

  /** Verify an entity's integrity by re-computing its checksum. */
  verifyIntegrity(entity: string, source: string): boolean {
    const expected = sha256(source + entity);
    const records = this.records.get(entity) ?? [];
    return records.some((r) => r.checksum === expected);
  }
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
