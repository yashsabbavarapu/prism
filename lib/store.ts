import { kv } from "@vercel/kv";
import type { EnrichmentSpend, LogEntry, MergeProposal, PrismRecord } from "./types";
import { buildSeed } from "./seed";

/**
 * Storage adapter. Vercel KV when KV_REST_API_URL / KV_REST_API_TOKEN are set,
 * otherwise an in-memory Map (resets on cold start). Both seed once with sample rows.
 */
export interface Store {
  readonly kind: "kv" | "memory";
  listRecords(): Promise<PrismRecord[]>;
  getRecord(id: string): Promise<PrismRecord | null>;
  putRecords(rs: PrismRecord[]): Promise<void>;
  listMerges(): Promise<MergeProposal[]>;
  getMerge(id: string): Promise<MergeProposal | null>;
  putMerge(m: MergeProposal): Promise<void>;
  deleteMerge(id: string): Promise<void>;
  listSpend(): Promise<EnrichmentSpend[]>;
  addSpend(s: EnrichmentSpend): Promise<void>;
  listLog(): Promise<LogEntry[]>;
  appendLog(e: LogEntry): Promise<void>;
  /** Count a hit in a fixed window; returns the count including this hit. */
  hit(key: string, windowSec: number): Promise<number>;
}

const newest = <T>(rows: T[], key: (r: T) => string) => rows.sort((a, b) => key(b).localeCompare(key(a)));

class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private records = new Map<string, PrismRecord>();
  private merges = new Map<string, MergeProposal>();
  private spend: EnrichmentSpend[] = [];
  private log: LogEntry[] = [];
  private hits = new Map<string, { n: number; resetAt: number }>();
  private ready: Promise<void>;

  constructor() {
    this.ready = buildSeed().then((s) => {
      for (const r of s.records) this.records.set(r.id, r);
      for (const m of s.merges) this.merges.set(m.id, m);
      this.spend.push(...s.spend);
      this.log.push(...s.log);
    });
  }

  async listRecords() {
    await this.ready;
    return Array.from(this.records.values());
  }
  async getRecord(id: string) {
    await this.ready;
    return this.records.get(id) ?? null;
  }
  async putRecords(rs: PrismRecord[]) {
    await this.ready;
    for (const r of rs) this.records.set(r.id, r);
  }
  async listMerges() {
    await this.ready;
    return newest(Array.from(this.merges.values()), (m) => m.created_at);
  }
  async getMerge(id: string) {
    await this.ready;
    return this.merges.get(id) ?? null;
  }
  async putMerge(m: MergeProposal) {
    await this.ready;
    this.merges.set(m.id, m);
  }
  async deleteMerge(id: string) {
    await this.ready;
    this.merges.delete(id);
  }
  async listSpend() {
    await this.ready;
    return newest([...this.spend], (s) => s.at);
  }
  async addSpend(s: EnrichmentSpend) {
    await this.ready;
    this.spend.push(s);
  }
  async listLog() {
    await this.ready;
    return newest([...this.log], (e) => e.at);
  }
  async appendLog(e: LogEntry) {
    await this.ready;
    this.log.push(e);
  }
  async hit(key: string, windowSec: number) {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + windowSec * 1000 });
      return 1;
    }
    cur.n += 1;
    return cur.n;
  }
}

const K = {
  records: "prism:records",
  merges: "prism:merges",
  spend: "prism:spend",
  log: "prism:log",
  seeded: "prism:seeded",
};

type Kv = typeof import("@vercel/kv").kv;

class KvStore implements Store {
  readonly kind = "kv" as const;
  private ready: Promise<void>;

  constructor(private kv: Kv) {
    this.ready = this.seedOnce();
  }

  private async seedOnce() {
    // SET NX: only the first deploy to reach an empty database seeds it.
    if ((await this.kv.set(K.seeded, "1", { nx: true })) === null) return;
    const s = await buildSeed();
    const map = <T extends { id: string }>(rows: T[]) => Object.fromEntries(rows.map((r) => [r.id, r]));
    await Promise.all([
      this.kv.hset(K.records, map(s.records)),
      s.merges.length ? this.kv.hset(K.merges, map(s.merges)) : null,
      ...s.spend.map((e) => this.kv.lpush(K.spend, e)),
      ...s.log.map((e) => this.kv.lpush(K.log, e)),
    ]);
  }

  async listRecords() {
    await this.ready;
    return Object.values((await this.kv.hgetall<Record<string, PrismRecord>>(K.records)) ?? {});
  }
  async getRecord(id: string) {
    await this.ready;
    return (await this.kv.hget<PrismRecord>(K.records, id)) ?? null;
  }
  async putRecords(rs: PrismRecord[]) {
    await this.ready;
    if (rs.length) await this.kv.hset(K.records, Object.fromEntries(rs.map((r) => [r.id, r])));
  }
  async listMerges() {
    await this.ready;
    const all = (await this.kv.hgetall<Record<string, MergeProposal>>(K.merges)) ?? {};
    return newest(Object.values(all), (m) => m.created_at);
  }
  async getMerge(id: string) {
    await this.ready;
    return (await this.kv.hget<MergeProposal>(K.merges, id)) ?? null;
  }
  async putMerge(m: MergeProposal) {
    await this.ready;
    await this.kv.hset(K.merges, { [m.id]: m });
  }
  async deleteMerge(id: string) {
    await this.ready;
    await this.kv.hdel(K.merges, id);
  }
  async listSpend() {
    await this.ready;
    return newest(await this.kv.lrange<EnrichmentSpend>(K.spend, 0, 4999), (s) => s.at);
  }
  async addSpend(s: EnrichmentSpend) {
    await this.ready;
    await this.kv.lpush(K.spend, s);
  }
  async listLog() {
    await this.ready;
    return newest(await this.kv.lrange<LogEntry>(K.log, 0, 499), (e) => e.at);
  }
  async appendLog(e: LogEntry) {
    await this.ready;
    await this.kv.lpush(K.log, e);
  }
  async hit(key: string, windowSec: number) {
    const k = `prism:rl:${key}`;
    const n = await this.kv.incr(k);
    if (n === 1) await this.kv.expire(k, windowSec);
    return n;
  }
}

export const kvConfigured = () => Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const g = globalThis as unknown as { __prismStore?: Store };

/** One store per server instance (survives dev hot reloads). */
export function getStore(): Store {
  if (!g.__prismStore) g.__prismStore = kvConfigured() ? new KvStore(kv) : new MemoryStore();
  return g.__prismStore;
}
