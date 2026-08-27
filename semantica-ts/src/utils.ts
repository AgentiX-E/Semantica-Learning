/**
 * Shared utility helpers — id generation, hashing, temporal parsing,
 * string similarity (Jaro–Winkler), and cosine similarity.
 */
import { createHash, randomUUID } from "node:crypto";

import type { Properties } from "./types.js";

/** Generate a stable UUID v4. */
export function uuid(): string {
  return randomUUID();
}

/** Generate a deterministic UUID v5-like id from a payload string. */
export function uuidFor(payload: string): string {
  // Namespace UUID for URLs; mirrors Python's uuid.NAMESPACE_URL usage.
  const namespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";
  const nsBytes = namespace.replace(/-/g, "");
  const payloadBytes = Buffer.from(payload, "utf8");
  const data = Buffer.concat([
    Buffer.from(nsBytes, "hex"),
    payloadBytes,
  ]);
  const hash = createHash("sha1").update(data).digest();
  hash[6] = ((hash[6]! & 0x0f) | 0x50); // version 5
  hash[8] = ((hash[8]! & 0x3f) | 0x80); // variant
  const hex = hash.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Parse an ISO-8601 datetime string (or year-only shorthand) into a Date, or null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  if (/^\d{4}$/.test(s)) {
    return new Date(`${s}-01-01T00:00:00.000Z`);
  }
  const iso = s.endsWith("Z") ? s : s.replace(/\+00:00$/, "Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Normalize a temporal input (Date | epoch seconds | ISO string) to an ISO string. */
export function normalizeTemporalInput(
  value: string | number | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const parsed = parseIsoDate(value);
  if (parsed === null) {
    throw new Error(`Temporal value ${JSON.stringify(value)} is not a valid ISO datetime string`);
  }
  return parsed.toISOString();
}

/** True if `at` lies within [validFrom, validUntil]. */
export function isActive(
  validFrom: string | null | undefined,
  validUntil: string | null | undefined,
  at: Date = new Date(),
): boolean {
  if (!validFrom && !validUntil) return true;
  const start = validFrom ? parseIsoDate(validFrom) : null;
  const end = validUntil ? parseIsoDate(validUntil) : null;
  if (start && at.getTime() < start.getTime()) return false;
  if (end && at.getTime() > end.getTime()) return false;
  return true;
}

/** Return the earlier of an existing end bound and a retraction time. */
export function closingValidUntil(current: string | null, atIso: string): string {
  if (current === null) return atIso;
  const existing = parseIsoDate(current);
  if (existing === null) return atIso;
  const requested = parseIsoDate(atIso);
  if (requested === null || existing.getTime() <= requested.getTime()) return current;
  return atIso;
}

/** Coerce a value to a finite number, falling back to a default. */
export function coerceFloat(value: unknown, fallback = 1.0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Pick the first non-null, non-empty value. */
export function pickFirst<T>(...values: Array<T | null | undefined>): T | null {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

/** Merge a set of metadata maps (last wins), ignoring non-objects. */
export function coerceMetadataMap(...values: Array<unknown>): Properties {
  const merged: Properties = {};
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(merged, value);
    }
  }
  return merged;
}

/** Jaro similarity between two strings (0..1). */
export function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const matchDistance = Math.max(a.length, b.length) / 2 - 1;
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchDistance);
    const hi = Math.min(i + matchDistance + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const t = transpositions / 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

/** Jaro–Winkler similarity (0..1), with standard prefix scaling. */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * prefixScale * (1 - j);
}

/** Cosine similarity between two equal-length numeric vectors. */
export function cosineSimilarity(x: number[], y: number[]): number {
  if (x.length !== y.length) {
    throw new Error(`Vector dimension mismatch: ${x.length} vs ${y.length}`);
  }
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i]! * y[i]!;
    nx += x[i]! * x[i]!;
    ny += y[i]! * y[i]!;
  }
  if (nx === 0 || ny === 0) return 0;
  return dot / (Math.sqrt(nx) * Math.sqrt(ny));
}

/** Classify a hop distance into a distance band (near / mid / far). */
export function classifyPathDistance(hop: number): string {
  if (hop <= 1) return "near";
  if (hop <= 3) return "mid";
  return "far";
}

/** Tokenize a string into lowercase words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean);
}
