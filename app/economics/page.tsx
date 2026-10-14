import Link from "next/link";
import { spendAction } from "../actions";
import { btn, input, Notice, SampleNotice, Table, Tag, Td, Th, when } from "@/components/ui";
import { economics } from "@/lib/service";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function EconomicsPage({ searchParams }: { searchParams: { msg?: string; err?: string } }) {
  const store = getStore();
  const [e, spend, records] = await Promise.all([economics(), store.listSpend(), store.listRecords()]);
  const names = new Map(records.map((r) => [r.id, r.name]));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Economics</h1>
      <Notice msg={searchParams.msg} err={searchParams.err} />
      {spend.some((s) => s.sample) && <SampleNotice />}

      <dl className="mb-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
        <dt className="text-neutral-500">Total spent</dt><dd>{e.total_credits} credits across {e.entries} entries</dd>
        <dt className="text-neutral-500">Verified-good records</dt><dd>{e.verified_good}</dd>
        <dt className="text-neutral-500">Cost per verified-good record</dt><dd>{e.cost_per_verified_good === null ? "n/a (none verified good)" : `${e.cost_per_verified_good} credits`}</dd>
        <dt className="text-neutral-500">Spent on records that are not verified good</dt><dd>{e.credits_on_not_good} credits ({e.total_credits ? Math.round((e.credits_on_not_good / e.total_credits) * 100) : 0}%)</dd>
      </dl>
      <p className="mb-6 text-xs text-neutral-500">
        Cost per verified-good record = total credits / records where the domain resolves, the email format passes, the MX check passes (or there is no email), and the record is not merged away as a duplicate. Credits are the vendor unit, not dollars.
      </p>

      <h2 className="mb-2 text-lg font-semibold">Log spend</h2>
      <form action={spendAction} className="mb-8 flex flex-wrap items-end gap-2">
        <label className="flex flex-col">Record id<input name="record_id" required className={input} placeholder="ct-dana" /></label>
        <label className="flex flex-col">Vendor<input name="vendor" required className={input} /></label>
        <label className="flex flex-col">Credits<input name="credits" type="number" step="any" min="0" required className={`${input} w-24`} /></label>
        <label className="flex flex-col">Note<input name="note" className={input} /></label>
        <button className={btn}>Log spend</button>
      </form>

      <h2 className="mb-2 text-lg font-semibold">By vendor</h2>
      <div className="mb-8">
        <Table>
          <thead><tr><Th>Vendor</Th><Th>Credits</Th><Th>Entries</Th></tr></thead>
          <tbody>{e.by_vendor.map((v) => <tr key={v.vendor}><Td>{v.vendor}</Td><Td>{v.credits}</Td><Td>{v.entries}</Td></tr>)}</tbody>
        </Table>
      </div>

      <h2 className="mb-2 text-lg font-semibold">Ledger</h2>
      <Table>
        <thead><tr><Th>When</Th><Th>Record</Th><Th>Vendor</Th><Th>Credits</Th><Th>Note</Th><Th>Outcome</Th></tr></thead>
        <tbody>
          {spend.map((s) => {
            const row = e.by_record.find((b) => b.record_id === s.record_id);
            return (
              <tr key={s.id}>
                <Td>{when(s.at)}</Td>
                <Td><Link className="underline" href={`/records/${encodeURIComponent(s.record_id)}`}>{names.get(s.record_id) ?? s.record_id}</Link>{s.sample && <span className="ml-1 text-xs text-neutral-500">sample</span>}</Td>
                <Td>{s.vendor}</Td>
                <Td>{s.credits}</Td>
                <Td>{s.note}</Td>
                <Td>{row?.verified_good ? <Tag tone="good">verified good</Tag> : row?.duplicate_of ? <Tag>duplicate</Tag> : <Tag tone="warn">not verified good</Tag>}</Td>
              </tr>
            );
          })}
          {spend.length === 0 && <tr><Td className="text-neutral-500">No spend logged.</Td></tr>}
        </tbody>
      </Table>
    </div>
  );
}
