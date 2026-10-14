import type { PrismRecord } from "./types";

export const NAME_THRESHOLD = 0.85;
/** Looser bar when the domain already matches. */
export const SAME_DOMAIN_NAME_THRESHOLD = 0.6;

const LEGAL_SUFFIXES = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "gmbh", "plc", "sa", "ag", "limited", "incorporated"]);

export function normalizeName(name: string): string {
  const tokens = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop();
  return tokens.join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 similarity of two names after normalization. Spaces are ignored so "Bright Wave" matches "Brightwave". */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a).replace(/\s+/g, "");
  const y = normalizeName(b).replace(/\s+/g, "");
  if (!x || !y) return 0;
  const longest = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / longest;
}

export interface Edge {
  a: string;
  b: string;
  reason: string;
  confidence: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function compareRecords(x: PrismRecord, y: PrismRecord): Edge | null {
  if (x.type !== y.type) return null;
  const emailX = x.email?.trim().toLowerCase();
  const emailY = y.email?.trim().toLowerCase();
  const sim = nameSimilarity(x.name, y.name);
  const sameDomain = Boolean(x.domain) && x.domain === y.domain;

  if (emailX && emailX === emailY) {
    return { a: x.id, b: y.id, reason: `same email ${emailX}, names ${pct(sim)} similar`, confidence: r2(0.95 + 0.05 * sim) };
  }
  if (sameDomain) {
    if (x.type === "company") {
      if (sim < SAME_DOMAIN_NAME_THRESHOLD) return null;
      return { a: x.id, b: y.id, reason: `same domain ${x.domain}, names ${pct(sim)} similar`, confidence: r2(0.75 + 0.25 * sim) };
    }
    // Colleagues share a domain, so contacts also need near-matching names.
    if (sim < SAME_DOMAIN_NAME_THRESHOLD) return null;
    return { a: x.id, b: y.id, reason: `same domain ${x.domain}, names ${pct(sim)} similar`, confidence: r2(0.5 + 0.45 * sim) };
  }
  // Different or missing domains: only company names are distinctive enough to match alone.
  if (x.type === "company" && sim >= NAME_THRESHOLD) {
    const domains = x.domain && y.domain ? `different domains (${x.domain}, ${y.domain})` : "domain missing on one side";
    return { a: x.id, b: y.id, reason: `names ${pct(sim)} similar, ${domains}`, confidence: r2(0.8 * sim) };
  }
  return null;
}

export interface Cluster {
  id: string;
  record_ids: string[];
  reason: string;
  confidence: number;
}

/** Stable id from the member ids, so the same group always yields the same proposal. */
export function clusterId(ids: string[]): string {
  const key = [...ids].sort().join("|");
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  return `mp_${h.toString(36)}${key.length.toString(36)}`;
}

/** Group matching records into clusters. Records already merged away must be filtered out by the caller. */
export function findClusters(records: PrismRecord[]): Cluster[] {
  const edges: Edge[] = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const e = compareRecords(records[i]!, records[j]!);
      if (e) edges.push(e);
    }
  }
  const parent = new Map<string, string>();
  const find = (s: string): string => {
    const p = parent.get(s) ?? s;
    if (p === s) return s;
    const root = find(p);
    parent.set(s, root);
    return root;
  };
  for (const e of edges) parent.set(find(e.a), find(e.b));

  const groups = new Map<string, Edge[]>();
  for (const e of edges) {
    const root = find(e.a);
    groups.set(root, [...(groups.get(root) ?? []), e]);
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  const clusters: Cluster[] = [];
  for (const es of groups.values()) {
    const ids = Array.from(new Set(es.flatMap((e) => [e.a, e.b]))).sort(
      (p, q) => (byId.get(p)!.ingested_at < byId.get(q)!.ingested_at ? -1 : 1),
    );
    const strongest = [...es].sort((p, q) => q.confidence - p.confidence);
    const names = ids.map((id) => byId.get(id)!.name);
    const reasons = Array.from(new Set(strongest.map((e) => e.reason)));
    const reason = `${names.join(" / ")}: ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? "; and more" : ""}`;
    clusters.push({
      id: clusterId(ids),
      record_ids: ids,
      reason,
      // A group is only as sure as its weakest link.
      confidence: Math.min(...es.map((e) => e.confidence)),
    });
  }
  return clusters.sort((p, q) => q.confidence - p.confidence);
}
