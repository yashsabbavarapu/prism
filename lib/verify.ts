import type { DnsEvidence, DomainAlive, EmailMx, EmailFormat, Evidence, PrismRecord, Verification } from "./types";

export const DOH_URL = "https://cloudflare-dns.com/dns-query";
export const DOH_TIMEOUT_MS = 8000;

/** Freshness formula, shown verbatim in the UI. */
export const FRESHNESS = {
  base: 100,
  perDay: 0.2,
  maxAgePenalty: 60,
  badFormat: 25,
  deadDomain: 40,
  noMx: 20,
  unknownCheck: 5,
  rottingBelow: 50,
} as const;

export const FORMULA_TEXT =
  `score = ${FRESHNESS.base} - min(${FRESHNESS.maxAgePenalty}, ${FRESHNESS.perDay} x age in days)` +
  ` - ${FRESHNESS.badFormat} if the email format is bad - ${FRESHNESS.deadDomain} if the domain is dead` +
  ` - ${FRESHNESS.noMx} if the email domain has no MX - ${FRESHNESS.unknownCheck} for each check that came back unknown,` +
  ` floored at 0. A record is rotting when the score is below ${FRESHNESS.rottingBelow}.`;

// ---------- pure parts ----------

const EMAIL_RE =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

export function checkEmailFormat(email: string | undefined): EmailFormat {
  if (!email) return "na";
  if (email.length > 254) return "bad";
  const at = email.lastIndexOf("@");
  if (at < 1 || at > 64) return "bad";
  return EMAIL_RE.test(email) ? "ok" : "bad";
}

export function emailDomain(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf("@");
  if (at < 0) return undefined;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || undefined;
}

/** Domain to run the A check on: the record's own, else the email's. */
export function domainToCheck(r: Pick<PrismRecord, "domain" | "email">): string | undefined {
  return r.domain || (checkEmailFormat(r.email) === "ok" ? emailDomain(r.email) : undefined);
}

export function ageDays(ingestedAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(ingestedAt).getTime();
  return Math.max(0, ms / 86_400_000);
}

export interface FreshnessPart {
  label: string;
  points: number;
}

export interface FreshnessResult {
  score: number;
  rotting: boolean;
  parts: FreshnessPart[];
}

export function freshness(ingestedAt: string, v: Verification, now: Date = new Date()): FreshnessResult {
  const days = ageDays(ingestedAt, now);
  const parts: FreshnessPart[] = [{ label: "Start", points: FRESHNESS.base }];
  const agePenalty = Math.min(FRESHNESS.maxAgePenalty, days * FRESHNESS.perDay);
  parts.push({ label: `Age ${Math.floor(days)} days`, points: -round1(agePenalty) });
  if (v.email_format === "bad") parts.push({ label: "Email format is bad", points: -FRESHNESS.badFormat });
  if (v.domain_alive === "dead") parts.push({ label: "Domain is dead", points: -FRESHNESS.deadDomain });
  if (v.domain_alive === "unknown") parts.push({ label: "Domain check unknown", points: -FRESHNESS.unknownCheck });
  if (v.email_mx === "none") parts.push({ label: "No MX records", points: -FRESHNESS.noMx });
  if (v.email_mx === "unknown") parts.push({ label: "MX check unknown", points: -FRESHNESS.unknownCheck });
  const raw = parts.reduce((s, p) => s + p.points, 0);
  const score = Math.max(0, Math.round(raw));
  return { score, rotting: score < FRESHNESS.rottingBelow, parts };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** A record counts as verified good when no check failed or is unknown and at least one passed. */
export function isVerifiedGood(r: Pick<PrismRecord, "verification" | "duplicate_of">): boolean {
  if (r.duplicate_of) return false;
  const v = r.verification;
  if (v.email_format === "bad" || v.domain_alive === "dead" || v.domain_alive === "unknown") return false;
  if (v.email_mx === "none" || v.email_mx === "unknown") return false;
  return v.domain_alive === "ok";
}

export function needsReview(r: Pick<PrismRecord, "verification" | "duplicate_of">): boolean {
  if (r.duplicate_of) return false;
  return !isVerifiedGood(r);
}

/** Interpret a DoH JSON response. Pure, so it is unit-tested. */
export function interpretA(rcode: number | null, answers: string[]): { status: DomainAlive; summary: string } {
  if (rcode === null) return { status: "unknown", summary: "Resolver unreachable. No answer received." };
  if (rcode === 3) return { status: "dead", summary: "NXDOMAIN: the domain does not exist." };
  if (rcode !== 0) return { status: "unknown", summary: `Resolver returned error code ${rcode}.` };
  if (answers.length === 0) return { status: "dead", summary: "Domain exists but has no A record." };
  return { status: "ok", summary: `Resolves to ${answers.join(", ")}.` };
}

export function interpretMx(rcode: number | null, answers: string[]): { status: EmailMx; summary: string } {
  if (rcode === null) return { status: "unknown", summary: "Resolver unreachable. No answer received." };
  if (rcode === 3) return { status: "none", summary: "NXDOMAIN: the domain does not exist, so it cannot receive mail." };
  if (rcode !== 0) return { status: "unknown", summary: `Resolver returned error code ${rcode}.` };
  const real = answers.filter((a) => {
    const host = a.trim().split(/\s+/)[1];
    return host !== undefined && host !== ".";
  });
  if (answers.length === 0) return { status: "none", summary: "No MX records." };
  if (real.length === 0) return { status: "none", summary: "Null MX (0 .): the domain says it accepts no mail." };
  return { status: "ok", summary: `Mail handled by ${real.join("; ")}` };
}

// ---------- DNS-over-HTTPS ----------

export interface DnsDeps {
  fetchImpl?: typeof fetch;
  url?: string;
  timeoutMs?: number;
}

const TYPE_CODE = { A: 1, MX: 15 } as const;

export async function dohLookup(name: string, type: "A" | "MX", deps: DnsDeps = {}): Promise<DnsEvidence> {
  const f = deps.fetchImpl ?? fetch;
  const url = deps.url ?? process.env.PRISM_DOH_URL ?? DOH_URL;
  const resolver = new URL(url).host;
  const base = { name, type, resolver };
  try {
    const res = await f(`${url}?name=${encodeURIComponent(name)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(deps.timeoutMs ?? DOH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ...base, rcode: null, answers: [], summary: `Resolver returned HTTP ${res.status}.` };
    const body = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
    if (typeof body.Status !== "number") return { ...base, rcode: null, answers: [], summary: "Resolver sent an unreadable answer." };
    const answers = (body.Answer ?? []).filter((a) => a.type === TYPE_CODE[type]).map((a) => a.data);
    return { ...base, rcode: body.Status, answers, summary: "" };
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "was unreachable";
    return { ...base, rcode: null, answers: [], summary: `Resolver ${why}. No answer received.` };
  }
}

export type DnsCache = Map<string, Promise<DnsEvidence>>;

function cachedLookup(name: string, type: "A" | "MX", deps: DnsDeps, cache?: DnsCache) {
  if (!cache) return dohLookup(name, type, deps);
  const key = `${type}:${name}`;
  let p = cache.get(key);
  if (!p) {
    p = dohLookup(name, type, deps);
    cache.set(key, p);
  }
  return p;
}

export interface VerifyResult {
  verification: Verification;
  evidence: Evidence;
}

/** Run all three checks live. Unreachable resolver yields "unknown", never ok. */
export async function verifyRecord(
  r: Pick<PrismRecord, "domain" | "email">,
  deps: DnsDeps = {},
  cache?: DnsCache,
): Promise<VerifyResult> {
  const email_format = checkEmailFormat(r.email);
  const formatNote =
    email_format === "na" ? "No email on this record." : email_format === "ok" ? "Matches the address pattern." : "Does not match the address pattern.";

  const domain = domainToCheck(r);
  let domain_alive: DomainAlive = "unknown";
  let aEvidence: Evidence["domain_alive"] = { summary: "No domain on this record, so there is nothing to look up." };
  if (domain) {
    const ev = await cachedLookup(domain, "A", deps, cache);
    const i = interpretA(ev.rcode, ev.answers);
    domain_alive = i.status;
    aEvidence = { ...ev, summary: i.summary };
  }

  let email_mx: EmailMx = "na";
  let mxEvidence: Evidence["email_mx"] = { summary: "No email on this record." };
  if (r.email) {
    const mxDomain = email_format === "ok" ? emailDomain(r.email) : undefined;
    if (!mxDomain) {
      email_mx = "unknown";
      mxEvidence = { summary: "The address is malformed, so there is no domain to look up." };
    } else {
      const ev = await cachedLookup(mxDomain, "MX", deps, cache);
      const i = interpretMx(ev.rcode, ev.answers);
      email_mx = i.status;
      mxEvidence = { ...ev, summary: i.summary };
    }
  }

  return {
    verification: { email_format, domain_alive, email_mx },
    evidence: { checked_at: new Date().toISOString(), email_format: formatNote, domain_alive: aEvidence, email_mx: mxEvidence },
  };
}
