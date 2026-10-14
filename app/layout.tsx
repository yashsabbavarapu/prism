import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { writesAuthenticated } from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Prism", description: "Verify records, merge duplicates, account for enrichment spend." };

const NAV = [
  ["/records", "Records"],
  ["/duplicates", "Duplicates"],
  ["/economics", "Economics"],
  ["/log", "Log"],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white font-sans text-sm text-neutral-900">
        <header className="border-b border-neutral-300">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3">
            <Link href="/" className="font-semibold">
              Prism
            </Link>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-neutral-700 underline-offset-4 hover:underline">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        {!writesAuthenticated() && (
          <footer className="mx-auto max-w-6xl px-4 pb-6 text-xs text-neutral-500">API writes are unauthenticated (PRISM_API_SECRET is not set).</footer>
        )}
      </body>
    </html>
  );
}
