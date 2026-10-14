import { Table, Td, Th, when } from "@/components/ui";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function LogPage() {
  const log = await getStore().listLog();
  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Audit log</h1>
      <p className="mb-4 text-xs text-neutral-500">Append-only. Every write is recorded here. Newest first; the latest 500 entries are shown.</p>
      <Table>
        <thead><tr><Th>When</Th><Th>Action</Th><Th>Target</Th><Th>Detail</Th></tr></thead>
        <tbody>
          {log.slice(0, 500).map((l) => (
            <tr key={l.id}>
              <Td>{when(l.at)}</Td>
              <Td>{l.action}{l.sample && <span className="ml-1 text-xs text-neutral-500">sample</span>}</Td>
              <Td className="break-all">{l.target}</Td>
              <Td>{l.detail}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
