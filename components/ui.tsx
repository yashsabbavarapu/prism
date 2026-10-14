import type { ReactNode } from "react";

export function Notice({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <p role="status" className={`mb-4 border px-3 py-2 ${err ? "border-red-400 bg-red-50 text-red-900" : "border-green-400 bg-green-50 text-green-900"}`}>
      {err ?? msg}
    </p>
  );
}

export function SampleNotice() {
  return <p className="mb-4 text-xs text-neutral-500">Rows marked sample are made-up seed data. Their domains are placeholders (iana.org, ietf.org, example.org, example.net, .invalid), so the DNS answers are real but say nothing about the fictional companies.</p>;
}

const TONE = {
  good: "border-green-600 text-green-800",
  bad: "border-red-600 text-red-800",
  warn: "border-amber-600 text-amber-800",
  neutral: "border-neutral-400 text-neutral-600",
} as const;

const BADGE_TONE: Record<string, keyof typeof TONE> = { ok: "good", bad: "bad", dead: "bad", none: "bad", unknown: "warn", na: "neutral" };

export function Badge({ label, value }: { label: string; value: string }) {
  return (
    <span className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${TONE[BADGE_TONE[value] ?? "neutral"]}`}>
      {label}: {value}
    </span>
  );
}

export function Tag({ tone = "neutral", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap border px-1.5 py-0.5 text-xs ${TONE[tone]}`}>{children}</span>;
}

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] border-collapse text-left">{children}</table>
  </div>
);
export const Th = ({ children }: { children?: ReactNode }) => <th className="border-b border-neutral-400 px-2 py-2 font-medium">{children}</th>;
export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`border-b border-neutral-200 px-2 py-2 align-top ${className}`}>{children}</td>;

export const btn = "border border-neutral-700 bg-white px-3 py-1.5 hover:bg-neutral-100";
export const input = "border border-neutral-400 px-2 py-1.5";

export const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";
