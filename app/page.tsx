import Link from "next/link";

export default function Home() {
  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">Prism</h1>
      <p className="mb-4">Verify records with live DNS checks, merge duplicates with stated reasons, and account for enrichment spend.</p>
      <ul className="list-disc pl-5">
        <li><Link className="underline" href="/records">Records</Link></li>
        <li><Link className="underline" href="/duplicates">Duplicates</Link></li>
        <li><Link className="underline" href="/economics">Economics</Link></li>
        <li><Link className="underline" href="/log">Audit log</Link></li>
      </ul>
    </div>
  );
}
