import Link from "next/link";
import { notFound } from "next/navigation";
import { verifyAction } from "../../actions";
import { Badge, btn, Notice, Tag, when } from "@/components/ui";
import { toView } from "@/lib/service";
import { getStore } from "@/lib/store";
import { FORMULA_TEXT } from "@/lib/verify";
import type { DnsEvidence } from "@/lib/types";

export const dynamic = "force-dynamic";

function Dns({ ev }: { ev: DnsEvidence | { summary: string } }) {
  if (!("resolver" in ev)) return <p>{ev.summary}</p>;
  return (
    <div>
      <p>{ev.summary}</p>
      <pre className="mt-1 overflow-x-auto bg-neutral-100 p-2 text-xs">
{`query:    ${ev.type} ${ev.name}
resolver: ${ev.resolver}
rcode:    ${ev.rcode === null ? "none (no response)" : ev.rcode}
answers:  ${ev.answers.length ? ev.answers.join("\n          ") : "(none)"}`}
      </pre>
    </div>
  );
}

export default async function RecordPage({ params, searchParams }: { params: { id: string }; searchParams: { msg?: string; err?: string } }) {
  const store = getStore();
  const rec = await store.getRecord(decodeURIComponent(params.id));
  if (!rec) notFound();
  const v = toView(rec);
  const spend = (await store.listSpend()).filter((s) => s.record_id === rec.id);
  const ev = rec.evidence;

  return (
    <div>
      <p className="mb-2"><Link className="underline" href="/records">Records</Link> / {rec.id}</p>
      <h1 className="mb-1 text-xl font-semibold">{rec.name} {rec.sample && <span className="text-xs font-normal text-neutral-500">sample</span>}</h1>
      <p className="mb-4 text-neutral-600">
        {rec.type}{rec.title ? `, ${rec.title}` : ""} · {rec.source} · ingested {when(rec.ingested_at)}
      </p>
      <Notice msg={searchParams.msg} err={searchParams.err} />
      {rec.duplicate_of && (
        <p className="mb-4">Merged away: duplicate of <Link className="underline" href={`/records/${encodeURIComponent(rec.duplicate_of)}`}>{rec.duplicate_of}</Link>. Excluded from lists.</p>
      )}
      <dl className="mb-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-neutral-500">Domain</dt><dd>{rec.domain ?? "none"}</dd>
        <dt className="text-neutral-500">Email</dt><dd className="break-all">{rec.email ?? "none"}</dd>
      </dl>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Checks</h2>
        <form action={verifyAction}>
          <input type="hidden" name="id" value={rec.id} />
          <button className={btn}>Re-run checks live</button>
        </form>
      </div>
      {ev ? <p className="mb-3 text-xs text-neutral-500">Last checked {when(ev.checked_at)}.</p> : <p className="mb-3">Not checked yet.</p>}

      <section className="mb-4 border border-neutral-300 p-3">
        <h3 className="mb-1 font-medium">Email format <Badge label="result" value={rec.verification.email_format} /></h3>
        <p>{ev?.email_format ?? "No evidence stored."}</p>
      </section>
      <section className="mb-4 border border-neutral-300 p-3">
        <h3 className="mb-1 font-medium">Domain alive (A record) <Badge label="result" value={rec.verification.domain_alive} /></h3>
        {ev ? <Dns ev={ev.domain_alive} /> : <p>No evidence stored.</p>}
      </section>
      <section className="mb-6 border border-neutral-300 p-3">
        <h3 className="mb-1 font-medium">Email MX <Badge label="result" value={rec.verification.email_mx} /></h3>
        {ev ? <Dns ev={ev.email_mx} /> : <p>No evidence stored.</p>}
      </section>

      <h2 className="mb-2 text-lg font-semibold">Freshness: {v.freshness_score} {v.rotting && <Tag tone="bad">rotting</Tag>}</h2>
      <table className="mb-2 border-collapse">
        <tbody>
          {v.freshness_parts.map((p, i) => (
            <tr key={i}><td className="pr-6">{p.label}</td><td className="text-right tabular-nums">{p.points > 0 && i > 0 ? "+" : ""}{p.points}</td></tr>
          ))}
          <tr className="border-t border-neutral-400"><td className="pr-6 font-medium">Score</td><td className="text-right font-medium tabular-nums">{v.freshness_score}</td></tr>
        </tbody>
      </table>
      <p className="mb-6 text-xs text-neutral-500">{FORMULA_TEXT} Freshness is recomputed from age every time this page loads.</p>

      <h2 className="mb-2 text-lg font-semibold">Enrichment spend</h2>
      {spend.length === 0 ? <p className="text-neutral-500">None logged.</p> : (
        <ul className="list-disc pl-5">{spend.map((s) => <li key={s.id}>{s.vendor}: {s.credits} credits{s.note ? ` (${s.note})` : ""}, {when(s.at)}</li>)}</ul>
      )}
    </div>
  );
}
