import { findClusters } from "./dedupe";
import { freshness, verifyRecord, type DnsCache } from "./verify";
import type { EnrichmentSpend, LogEntry, MergeProposal, PrismRecord, RecordInput } from "./types";

/**
 * Sample data. Every row is tagged `sample: true`.
 * Domains are real so the DNS checks return real answers: iana.org and ietf.org have MX records,
 * example.org and example.net resolve but have no mail, and the .invalid names never resolve (RFC 6761).
 * All people and companies are made up.
 */
interface SeedRow extends RecordInput {
  id: string;
  ageDays: number;
}

const ROWS: SeedRow[] = [
  // Acme Robotics (live, has MX). Planted: company dupe by domain, contact dupe by email, bad email format.
  { id: "co-acme", type: "company", name: "Acme Robotics", domain: "iana.org", source: "Conference scan", ageDays: 20 },
  { id: "co-acme-2", type: "company", name: "Acme Robotics Inc.", domain: "iana.org", source: "Purchased list", ageDays: 95 },
  { id: "ct-dana", type: "contact", name: "Dana Whitfield", title: "VP Sales", email: "dana.whitfield@iana.org", domain: "iana.org", source: "Conference scan", ageDays: 20 },
  { id: "ct-dana-2", type: "contact", name: "Dana Whitfield", title: "Vice President, Sales", email: "Dana.Whitfield@IANA.org", domain: "iana.org", source: "Purchased list", ageDays: 95 },
  { id: "ct-marcus", type: "contact", name: "Marcus Oyelaran", title: "CTO", email: "marcus.oyelaran(at)iana.org", domain: "iana.org", source: "Purchased list", ageDays: 95 },
  { id: "ct-priya", type: "contact", name: "Priya Raman", title: "Head of Operations", email: "priya.raman@iana.org", domain: "iana.org", source: "Conference scan", ageDays: 20 },

  // Brightwave Analytics (live, has MX). Planted: company fuzzy dupe on a different domain, contact same-domain dupe.
  { id: "co-bright", type: "company", name: "Brightwave Analytics", domain: "ietf.org", source: "CRM export", ageDays: 40 },
  { id: "co-bright-2", type: "company", name: "Bright Wave Analytics", domain: "example.org", source: "Web form", ageDays: 12 },
  { id: "ct-lena", type: "contact", name: "Lena Haugen", title: "Director of Marketing", email: "lena.haugen@ietf.org", domain: "ietf.org", source: "CRM export", ageDays: 40 },
  { id: "ct-lena-2", type: "contact", name: "Lena Haugen", title: "Marketing Director", email: "l.haugen@ietf.org", domain: "ietf.org", source: "Web form", ageDays: 12 },
  { id: "ct-tomas", type: "contact", name: "Tomas Brandt", title: "Account Executive", email: "tomas.brandt@ietf.org", domain: "ietf.org", source: "CRM export", ageDays: 40 },
  { id: "ct-ayesha", type: "contact", name: "Ayesha Karim", title: "RevOps Lead", email: "ayesha.karim@example.org", domain: "example.org", source: "Web form", ageDays: 12 },

  // Northgate Logistics (dead domain, old data).
  { id: "co-north", type: "company", name: "Northgate Logistics", domain: "northgate-logistics.invalid", source: "Purchased list", ageDays: 410 },
  { id: "ct-ruth", type: "contact", name: "Ruth Calloway", title: "COO", email: "ruth.calloway@northgate-logistics.invalid", domain: "northgate-logistics.invalid", source: "Purchased list", ageDays: 410 },
  { id: "ct-ben", type: "contact", name: "Ben Ortega", title: "Fleet Manager", email: "ben.ortega@northgate-logistics.invalid", domain: "northgate-logistics.invalid", source: "Purchased list", ageDays: 380 },

  // Quillfoundry Labs (dead domain).
  { id: "co-quill", type: "company", name: "Quillfoundry Labs", domain: "quillfoundry.invalid", source: "Web form", ageDays: 150 },
  { id: "ct-sofia", type: "contact", name: "Sofia Lindqvist", title: "Founder", email: "sofia@quillfoundry.invalid", domain: "quillfoundry.invalid", source: "Web form", ageDays: 150 },
  { id: "ct-jamal", type: "contact", name: "Jamal Reid", title: "Head of Growth", domain: "quillfoundry.invalid", source: "Web form", ageDays: 150 },

  // Strays on example.net (resolves, no mail).
  { id: "ct-jonas", type: "contact", name: "Jonas Weber", title: "Procurement", email: "jonas.weber@example.net", domain: "example.net", source: "Conference scan", ageDays: 60 },
  { id: "ct-ines", type: "contact", name: "Ines Duarte", title: "Partnerships", email: "ines.duarte@example.net", domain: "example.net", source: "Conference scan", ageDays: 60 },
];

const SPEND: { record_id: string; vendor: string; credits: number; note: string; daysAgo: number }[] = [
  { record_id: "ct-dana", vendor: "Sumble", credits: 10, note: "Email reveal", daysAgo: 18 },
  { record_id: "ct-priya", vendor: "Sumble", credits: 10, note: "Email reveal", daysAgo: 18 },
  { record_id: "ct-dana-2", vendor: "Apollo", credits: 4, note: "Email lookup, same person as ct-dana", daysAgo: 90 },
  { record_id: "ct-ruth", vendor: "Apollo", credits: 4, note: "Email lookup", daysAgo: 300 },
  { record_id: "co-bright", vendor: "Sumble", credits: 3, note: "Firmographics", daysAgo: 35 },
  { record_id: "ct-sofia", vendor: "Clearbit", credits: 6, note: "Contact enrichment", daysAgo: 140 },
];

export interface SeedData {
  records: PrismRecord[];
  merges: MergeProposal[];
  spend: EnrichmentSpend[];
  log: LogEntry[];
}

const DAY = 86_400_000;

export async function buildSeed(now: Date = new Date()): Promise<SeedData> {
  const cache: DnsCache = new Map();
  const records: PrismRecord[] = await Promise.all(
    ROWS.map(async ({ ageDays, ...row }) => {
      const ingested_at = new Date(now.getTime() - ageDays * DAY).toISOString();
      const { verification, evidence } = await verifyRecord(row, {}, cache);
      return {
        ...row,
        ingested_at,
        verification,
        evidence,
        freshness_score: freshness(ingested_at, verification, now).score,
        sample: true,
      } satisfies PrismRecord;
    }),
  );

  const at = now.toISOString();
  const merges: MergeProposal[] = findClusters(records).map((c) => ({
    id: c.id,
    record_ids: c.record_ids,
    reason: c.reason,
    confidence: c.confidence,
    status: "pending",
    created_at: at,
    sample: true,
  }));

  const spend: EnrichmentSpend[] = SPEND.map((s, i) => ({
    id: `sp-${i + 1}`,
    at: new Date(now.getTime() - s.daysAgo * DAY).toISOString(),
    record_id: s.record_id,
    vendor: s.vendor,
    credits: s.credits,
    note: s.note,
    sample: true,
  }));

  const log: LogEntry[] = [
    { id: "lg-seed-1", at, action: "seed", target: "records", detail: `Loaded ${records.length} sample records and verified them live.`, sample: true },
    ...merges.map((m, i) => ({
      id: `lg-seed-m${i}`,
      at,
      action: "merge.propose",
      target: m.id,
      detail: m.reason,
      sample: true,
    })),
    ...spend.map((s) => ({
      id: `lg-${s.id}`,
      at: s.at,
      action: "spend.log",
      target: s.record_id,
      detail: `${s.vendor} ${s.credits} credits${s.note ? `: ${s.note}` : ""}`,
      sample: true,
    })),
  ];

  return { records, merges, spend, log };
}
