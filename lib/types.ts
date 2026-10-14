export type RecordType = "company" | "contact";
export type EmailFormat = "ok" | "bad" | "na";
export type DomainAlive = "ok" | "dead" | "unknown";
export type EmailMx = "ok" | "none" | "unknown" | "na";

export interface Verification {
  email_format: EmailFormat;
  domain_alive: DomainAlive;
  /** "na" when the record has no email address to check. */
  email_mx: EmailMx;
}

/** The raw DNS answer behind a check, kept so the detail page can show it. */
export interface DnsEvidence {
  name: string;
  type: "A" | "MX";
  /** DNS RCODE from the resolver (0 NOERROR, 3 NXDOMAIN), or null when unreachable. */
  rcode: number | null;
  answers: string[];
  /** Plain-words reading of the answer. */
  summary: string;
  resolver: string;
}

export interface Evidence {
  checked_at: string;
  email_format: string;
  domain_alive: DnsEvidence | { summary: string };
  email_mx: DnsEvidence | { summary: string };
}

export interface PrismRecord {
  id: string;
  type: RecordType;
  name: string;
  domain?: string;
  email?: string;
  title?: string;
  source: string;
  ingested_at: string;
  verification: Verification;
  freshness_score: number;
  duplicate_of?: string;
  evidence?: Evidence;
  sample?: boolean;
}

export interface MergeProposal {
  id: string;
  record_ids: string[];
  reason: string;
  confidence: number;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  decided_at?: string;
  /** Record kept when accepted. */
  kept_id?: string;
  sample?: boolean;
}

export interface EnrichmentSpend {
  id: string;
  at: string;
  record_id: string;
  vendor: string;
  credits: number;
  note?: string;
  sample?: boolean;
}

export interface LogEntry {
  id: string;
  at: string;
  action: string;
  target: string;
  detail: string;
  sample?: boolean;
}

export interface RecordInput {
  id?: string;
  type: RecordType;
  name: string;
  domain?: string;
  email?: string;
  title?: string;
  source: string;
  ingested_at?: string;
}
