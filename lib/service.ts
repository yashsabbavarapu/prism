import { randomBytes } from "node:crypto";
import { findClusters } from "./dedupe";
import { getStore } from "./store";
import { checkEmailFormat, freshness, isVerifiedGood, needsReview, verifyRecord, FRESHNESS, type DnsCache } from "./verify";
import type { EnrichmentSpend, LogEntry, MergeProposal, PrismRecord, RecordInput } from "./types";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: object = {},
  ) {
    super(message);
  }
}

export const MAX_BATCH = 200;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const newId = (prefix: string) => `${prefix}_${randomBytes(5).toString("hex")}`;

// ---------- audit ----------

export async function audit(action: string, target: string, detail: string) {
  const e: LogEntry = { id: newId("lg"), at: new Date().toISOString(), action, target, detail };
  await getStore().appendLog(e);
}

// ---------- validation ----------

function optString(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new HttpError(400, `${field} must be a string.`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return s || undefined;
}

/** Strip scheme, path and leading www so "https://www.Acme.com/about" becomes "acme.com". */
export function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

export function parseRecordInput(raw: unknown, index?: number): RecordInput {
  const where = index === undefined ? "" : `Record ${index + 1}: `;
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "must be an object.");
    const o = raw as Record<string, unknown>;
    if (o.type !== "company" && o.type !== "contact") throw new HttpError(400, 'type must be "company" or "contact".');
    const name = optString(o.name, "name", 200);
    if (!name) throw new HttpError(400, "name is required.");
    const source = optString(o.source, "source", 100);
    if (!source) throw new HttpError(400, "source is required.");
    const id = optString(o.id, "id", 80);
    if (id && !/^[A-Za-z0-9_.:-]+$/.test(id)) throw new HttpError(400, "id may only use letters, digits and _ . : -");
    const domainRaw = optString(o.domain, "domain", 300);
    const domain = domainRaw ? normalizeDomain(domainRaw) : undefined;
    if (domain && !HOST_RE.test(domain)) throw new HttpError(400, `domain "${domainRaw}" is not a valid hostname.`);
    const ingested = optString(o.ingested_at, "ingested_at", 40);
    if (ingested) {
      const t = Date.parse(ingested);
      if (Number.isNaN(t)) throw new HttpError(400, "ingested_at must be an ISO date.");
      if (t > Date.now() + 60_000) throw new HttpError(400, "ingested_at cannot be in the future.");
    }
    return {
      id,
      type: o.type,
      name,
      domain,
      email: optString(o.email, "email", 320),
      title: optString(o.title, "title", 200),
      source,
      ingested_at: ingested ? new Date(ingested).toISOString() : undefined,
    };
  } catch (e) {
    if (e instanceof HttpError) throw new HttpError(e.status, `${where}${e.message}`);
    throw e;
  }
}

// ---------- read-time derivations ----------

export type View = PrismRecord & { rotting: boolean; freshness_parts: { label: string; points: number }[]; verified_good: boolean; needs_review: boolean };

export function toView(r: PrismRecord, now = new Date()): View {
  const f = freshness(r.ingested_at, r.verification, now);
  return { ...r, freshness_score: f.score, rotting: f.rotting, freshness_parts: f.parts, verified_good: isVerifiedGood(r), needs_review: needsReview(r) };
}

export type StatusFilter = "all" | "needs_review" | "rotting" | "duplicates";
export const STATUS_FILTERS: StatusFilter[] = ["all", "needs_review", "rotting", "duplicates"];

export function filterViews(views: View[], status: StatusFilter): View[] {
  switch (status) {
    case "all":
      // Merged-away duplicates are excluded from lists.
      return views.filter((v) => !v.duplicate_of);
    case "needs_review":
      return views.filter((v) => v.needs_review);
    case "rotting":
      return views.filter((v) => v.rotting && !v.duplicate_of);
    case "duplicates":
      return views.filter((v) => Boolean(v.duplicate_of));
  }
}

export async function listRecordViews(status: StatusFilter = "all"): Promise<View[]> {
  const rows = await getStore().listRecords();
  const views = rows.map((r) => toView(r));
  views.sort((a, b) => b.ingested_at.localeCompare(a.ingested_at) || a.id.localeCompare(b.id));
  return filterViews(views, status);
}

// ---------- ingest ----------

async function verifyAll(inputs: PrismRecord[]): Promise<void> {
  const cache: DnsCache = new Map();
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const r = inputs[next++]!;
      const { verification, evidence } = await verifyRecord(r, {}, cache);
      r.verification = verification;
      r.evidence = evidence;
      r.freshness_score = freshness(r.ingested_at, verification).score;
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, inputs.length) }, worker));
}

/** Create or refresh merge proposals for all active records. Returns the proposals created. */
export async function proposeMerges(): Promise<MergeProposal[]> {
  const store = getStore();
  const [records, merges] = await Promise.all([store.listRecords(), store.listMerges()]);
  const active = records.filter((r) => !r.duplicate_of);
  const created: MergeProposal[] = [];
  const now = new Date().toISOString();
  for (const c of findClusters(active)) {
    if (merges.some((m) => m.id === c.id)) continue;
    // A pending proposal that this group grew out of is replaced by the larger one.
    for (const old of merges) {
      if (old.status === "pending" && old.record_ids.some((id) => c.record_ids.includes(id))) {
        await store.deleteMerge(old.id);
        await audit("merge.supersede", old.id, `Replaced by ${c.id}, which now covers ${c.record_ids.length} records.`);
      }
    }
    const p: MergeProposal = { id: c.id, record_ids: c.record_ids, reason: c.reason, confidence: c.confidence, status: "pending", created_at: now };
    await store.putMerge(p);
    await audit("merge.propose", p.id, p.reason);
    created.push(p);
  }
  return created;
}

export async function ingestRecords(rawList: unknown[]): Promise<{ records: View[]; proposals: MergeProposal[] }> {
  if (rawList.length === 0) throw new HttpError(400, "No records supplied.");
  if (rawList.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} records per request.`);
  const store = getStore();
  const inputs = rawList.map((r, i) => parseRecordInput(r, i));

  const existing = new Map((await store.listRecords()).map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const [i, inp] of inputs.entries()) {
    if (!inp.id) continue;
    const prior = existing.get(inp.id);
    if (prior) throw new HttpError(409, `Record id "${inp.id}" already exists. Nothing was saved.`, { existing: toView(prior) });
    if (seen.has(inp.id)) throw new HttpError(400, `Record ${i + 1}: id "${inp.id}" appears twice in this batch.`);
    seen.add(inp.id);
  }

  const now = new Date().toISOString();
  const recs: PrismRecord[] = inputs.map((inp) => ({
    id: inp.id ?? newId("rec"),
    type: inp.type,
    name: inp.name,
    domain: inp.domain,
    email: inp.email,
    title: inp.title,
    source: inp.source,
    ingested_at: inp.ingested_at ?? now,
    verification: { email_format: checkEmailFormat(inp.email), domain_alive: "unknown", email_mx: "na" },
    freshness_score: 100,
  }));
  await verifyAll(recs);
  await store.putRecords(recs);
  for (const r of recs) await audit("record.ingest", r.id, `${r.type} "${r.name}" from ${r.source}; ${summarizeChecks(r)}`);
  const proposals = await proposeMerges();
  return { records: recs.map((r) => toView(r)), proposals };
}

export function summarizeChecks(r: PrismRecord): string {
  const v = r.verification;
  return `email format ${v.email_format}, domain ${v.domain_alive}, MX ${v.email_mx}`;
}

// ---------- verify ----------

export async function reverify(id: string): Promise<View> {
  const store = getStore();
  const r = await store.getRecord(id);
  if (!r) throw new HttpError(404, `No record with id "${id}".`);
  const { verification, evidence } = await verifyRecord(r);
  const next: PrismRecord = { ...r, verification, evidence, freshness_score: freshness(r.ingested_at, verification).score };
  await store.putRecords([next]);
  await audit("record.verify", id, summarizeChecks(next));
  return toView(next);
}

// ---------- merge decisions ----------

export async function decideMerge(id: string, body: unknown): Promise<MergeProposal> {
  const store = getStore();
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const decision = o.decision;
  if (decision !== "accept" && decision !== "reject") throw new HttpError(400, 'decision must be "accept" or "reject".');
  const m = await store.getMerge(id);
  if (!m) throw new HttpError(404, `No merge proposal with id "${id}".`);
  if (m.status !== "pending") throw new HttpError(409, `Proposal is already ${m.status}.`, { existing: m });
  const now = new Date().toISOString();

  if (decision === "reject") {
    const next: MergeProposal = { ...m, status: "rejected", decided_at: now };
    await store.putMerge(next);
    await audit("merge.reject", id, `Dismissed: ${m.reason}`);
    return next;
  }

  const members = (await Promise.all(m.record_ids.map((rid) => store.getRecord(rid)))).filter((r): r is PrismRecord => Boolean(r));
  if (members.length < 2) throw new HttpError(409, "Fewer than two of the proposal's records still exist.");
  let keep: PrismRecord | undefined;
  if (o.keep !== undefined) {
    keep = members.find((r) => r.id === o.keep);
    if (!keep) throw new HttpError(400, "keep must be one of the proposal's record ids.");
  } else {
    // Default survivor: highest freshness, then the earliest ingested.
    keep = [...members].sort((a, b) => toView(b).freshness_score - toView(a).freshness_score || a.ingested_at.localeCompare(b.ingested_at))[0]!;
  }
  const losers = members.filter((r) => r.id !== keep!.id).map((r) => ({ ...r, duplicate_of: keep!.id }));
  await store.putRecords(losers);
  const next: MergeProposal = { ...m, status: "accepted", decided_at: now, kept_id: keep.id };
  await store.putMerge(next);
  await audit("merge.accept", id, `Kept ${keep.id}; marked ${losers.map((l) => l.id).join(", ")} as duplicate_of ${keep.id}.`);
  return next;
}

// ---------- spend ----------

export async function logSpend(body: unknown): Promise<EnrichmentSpend> {
  const o = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const record_id = optString(o.record_id, "record_id", 80);
  if (!record_id) throw new HttpError(400, "record_id is required.");
  const vendor = optString(o.vendor, "vendor", 100);
  if (!vendor) throw new HttpError(400, "vendor is required.");
  const credits = o.credits;
  if (typeof credits !== "number" || !Number.isFinite(credits) || credits <= 0 || credits > 1_000_000) {
    throw new HttpError(400, "credits must be a positive number up to 1,000,000.");
  }
  const note = optString(o.note, "note", 300);
  const store = getStore();
  if (!(await store.getRecord(record_id))) throw new HttpError(404, `No record with id "${record_id}".`);
  const s: EnrichmentSpend = { id: newId("sp"), at: new Date().toISOString(), record_id, vendor, credits, ...(note ? { note } : {}) };
  await store.addSpend(s);
  await audit("spend.log", record_id, `${vendor} ${credits} credits${note ? `: ${note}` : ""}`);
  return s;
}

export interface Economics {
  total_credits: number;
  entries: number;
  verified_good: number;
  cost_per_verified_good: number | null;
  /** Credits spent on records that are now duplicates, dead or otherwise not verified good. */
  credits_on_not_good: number;
  by_vendor: { vendor: string; credits: number; entries: number }[];
  by_record: { record_id: string; name: string; credits: number; verified_good: boolean; duplicate_of?: string }[];
}

export async function economics(): Promise<Economics> {
  const store = getStore();
  const [spend, records] = await Promise.all([store.listSpend(), store.listRecords()]);
  const byId = new Map(records.map((r) => [r.id, r]));
  const total = spend.reduce((s, e) => s + e.credits, 0);
  const good = records.filter((r) => isVerifiedGood(r)).length;
  const vendors = new Map<string, { credits: number; entries: number }>();
  const recs = new Map<string, number>();
  let notGood = 0;
  for (const e of spend) {
    const v = vendors.get(e.vendor) ?? { credits: 0, entries: 0 };
    vendors.set(e.vendor, { credits: v.credits + e.credits, entries: v.entries + 1 });
    recs.set(e.record_id, (recs.get(e.record_id) ?? 0) + e.credits);
    const r = byId.get(e.record_id);
    if (!r || !isVerifiedGood(r)) notGood += e.credits;
  }
  return {
    total_credits: total,
    entries: spend.length,
    verified_good: good,
    cost_per_verified_good: good > 0 ? Math.round((total / good) * 100) / 100 : null,
    credits_on_not_good: notGood,
    by_vendor: Array.from(vendors, ([vendor, v]) => ({ vendor, ...v })).sort((a, b) => b.credits - a.credits),
    by_record: Array.from(recs, ([record_id, credits]) => {
      const r = byId.get(record_id);
      return { record_id, name: r?.name ?? "(missing)", credits, verified_good: r ? isVerifiedGood(r) : false, duplicate_of: r?.duplicate_of };
    }).sort((a, b) => b.credits - a.credits),
  };
}

export { FRESHNESS };
