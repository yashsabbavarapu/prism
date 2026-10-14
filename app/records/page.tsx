import Link from "next/link";
import { uploadCsv } from "../actions";
import { Badge, btn, Notice, SampleNotice, Table, Tag, Td, Th, when } from "@/components/ui";
import { FORMULA_TEXT } from "@/lib/verify";
import { listRecordViews, STATUS_FILTERS, type StatusFilter } from "@/lib/service";

export const dynamic = "force-dynamic";

const LABEL: Record<StatusFilter, string> = { all: "All", needs_review: "Needs review", rotting: "Rotting", duplicates: "Duplicates" };

export default async function RecordsPage({ searchParams }: { searchParams: { status?: string; msg?: string; err?: string } }) {
  const status = (STATUS_FILTERS as string[]).includes(searchParams.status ?? "") ? (searchParams.status as StatusFilter) : "all";
  const [rows, all] = await Promise.all([listRecordViews(status), listRecordViews("all")]);
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Records</h1>
      <Notice msg={searchParams.msg} err={searchParams.err} />
      {all.some((r) => r.sample) && <SampleNotice />}

      <form action={uploadCsv} className="mb-6 flex flex-wrap items-center gap-2 border border-neutral-300 p-3">
        <label htmlFor="file">Upload CSV</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" className="max-w-full" />
        <button className={btn}>Upload and verify</button>
        <p className="w-full text-xs text-neutral-500">Columns: name (required), type, domain, email, title, source, id, ingested_at. Type defaults to contact when an email is present. Up to 200 rows. Each row is checked live against DNS.</p>
      </form>

      <div className="mb-3 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Link key={s} href={s === "all" ? "/records" : `/records?status=${s}`} className={`border px-3 py-1 ${s === status ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-400"}`}>
            {LABEL[s]}
          </Link>
        ))}
      </div>
      <p className="mb-2 text-xs text-neutral-500">{rows.length} shown. Records merged away as duplicates are hidden except under Duplicates.</p>

      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Type</Th>
            <Th>Domain / email</Th>
            <Th>Checks</Th>
            <Th>Freshness</Th>
            <Th>Source</Th>
            <Th>Ingested</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link className="underline" href={`/records/${encodeURIComponent(r.id)}`}>{r.name}</Link>
                {r.sample && <span className="ml-1 text-xs text-neutral-500">sample</span>}
                {r.title && <div className="text-xs text-neutral-500">{r.title}</div>}
                {r.duplicate_of && <div className="text-xs text-neutral-500">duplicate of {r.duplicate_of}</div>}
              </Td>
              <Td>{r.type}</Td>
              <Td className="break-all">
                {r.domain}
                {r.email && <div className="text-xs text-neutral-600">{r.email}</div>}
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Badge label="format" value={r.verification.email_format} />
                  <Badge label="domain" value={r.verification.domain_alive} />
                  <Badge label="mx" value={r.verification.email_mx} />
                </div>
              </Td>
              <Td>
                {r.freshness_score} {r.rotting && <Tag tone="bad">rotting</Tag>}
              </Td>
              <Td>{r.source}</Td>
              <Td>{when(r.ingested_at)}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><Td className="text-neutral-500">No records match.</Td></tr>
          )}
        </tbody>
      </Table>
      <p className="mt-4 text-xs text-neutral-500">Freshness: {FORMULA_TEXT}</p>
    </div>
  );
}
