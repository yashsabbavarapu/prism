import Link from "next/link";
import { decideAction } from "../actions";
import { btn, Notice, SampleNotice, Tag, when } from "@/components/ui";
import { getStore } from "@/lib/store";
import { toView } from "@/lib/service";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const store = getStore();
  const [merges, records] = await Promise.all([store.listMerges(), store.listRecords()]);
  const byId = new Map(records.map((r) => [r.id, r]));
  const pending = merges.filter((m) => m.status === "pending");
  const decided = merges.filter((m) => m.status !== "pending");

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Duplicates</h1>
      <Notice msg={searchParams.msg} err={searchParams.err} />
      {merges.some((m) => m.sample) && <SampleNotice />}
      <p className="mb-4 text-xs text-neutral-500">
        Accepting keeps one record (default: highest freshness, then earliest ingested) and sets duplicate_of on the others, which then drop out of lists. Confidence is the weakest match in the group.
      </p>

      <h2 className="mb-2 text-lg font-semibold">Pending ({pending.length})</h2>
      {pending.length === 0 && <p className="mb-6 text-neutral-500">No pending proposals.</p>}
      <ul className="mb-8 space-y-4">
        {pending.map((m) => {
          const members = m.record_ids.map((id) => byId.get(id)).filter((r) => Boolean(r));
          const defaultKeep = [...members].sort((a, b) => toView(b!).freshness_score - toView(a!).freshness_score || a!.ingested_at.localeCompare(b!.ingested_at))[0]?.id;
          return (
            <li key={m.id} className="border border-neutral-300 p-3">
              <p className="mb-1"><Tag>{Math.round(m.confidence * 100)}% confidence</Tag> {m.sample && <span className="text-xs text-neutral-500">sample</span>}</p>
              <p className="mb-2">{m.reason}</p>
              <ul className="mb-3 overflow-x-auto">
                {members.map((r) => (
                  <li key={r!.id} className="whitespace-nowrap">
                    <Link className="underline" href={`/records/${encodeURIComponent(r!.id)}`}>{r!.name}</Link>
                    <span className="text-neutral-600"> · {r!.domain ?? "no domain"}{r!.email ? ` · ${r!.email}` : ""} · {r!.source} · freshness {toView(r!).freshness_score}</span>
                  </li>
                ))}
              </ul>
              <form action={decideAction} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={m.id} />
                <label className="flex items-center gap-1">
                  Keep
                  <select name="keep" defaultValue={defaultKeep} className="border border-neutral-400 px-1 py-1">
                    {members.map((r) => <option key={r!.id} value={r!.id}>{r!.name} ({r!.id})</option>)}
                  </select>
                </label>
                <button name="decision" value="accept" className={btn}>Accept merge</button>
                <button name="decision" value="reject" className={btn}>Reject</button>
              </form>
            </li>
          );
        })}
      </ul>

      <h2 className="mb-2 text-lg font-semibold">Decided ({decided.length})</h2>
      {decided.length === 0 && <p className="text-neutral-500">Nothing decided yet.</p>}
      <ul className="space-y-2">
        {decided.map((m) => (
          <li key={m.id} className="border-b border-neutral-200 pb-2">
            <Tag tone={m.status === "accepted" ? "good" : "neutral"}>{m.status}</Tag> {m.decided_at && <span className="text-xs text-neutral-500">{when(m.decided_at)}</span>}
            <p>{m.reason}</p>
            {m.kept_id && <p className="text-xs text-neutral-600">Kept {m.kept_id}.</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
