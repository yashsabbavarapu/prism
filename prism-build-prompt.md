# Build: Prism v1 (functionality only)

Read FIRST: `/home/hatch/workspace/goals/build-the-end-to-end-gtm-ai-application/files/prism-functional-spec.md` (the contract) and `/home/hatch/workspace/goals/build-the-end-to-end-gtm-ai-application/files/build-conventions.md` (stack, storage, write protection, API norms, acceptance — all binding).

## Build order
1. `lib/verify.ts`: email-format check, DNS-over-HTTPS A and MX lookups (Cloudflare `https://cloudflare-dns.com/dns-query?name=...&type=...` with `accept: application/dns-json`, 8s timeout; unreachable → "unknown", never fake an ok), freshness scoring with the documented formula. Unit-test the pure parts (format, freshness math, dedupe similarity).
2. `lib/dedupe.ts`: exact (domain, email) + fuzzy (normalized name similarity ≥ 0.85, same-domain similar names) → merge proposals with plain-word reasons and confidence.
3. `lib/store.ts` + `lib/seed.ts` (~20 records, planted duplicates, two dead domains, spend rows; all `sample: true`).
4. API: `POST /api/records`, `POST /api/records/[id]/verify`, `POST /api/merges/[id]/decision`, `POST /api/spend`, `GET /api/records`, `GET /api/merges`, `GET /api/spend`.
5. Pages: `/` (minimal), `/records` (badges, freshness, filters, CSV upload), `/records/[id]` (each check with its actual DNS evidence), `/duplicates` (proposals with reasons, accept/reject), `/economics` (spend ledger, cost per verified-good record), `/log`.

## Acceptance
Per build-conventions.md, plus: curl the loop (upload CSV → records appear with verification → duplicates proposed with reasons → accept one → duplicate_of set → log spend → economics adds up). Verify a real domain check returns live DNS evidence and an unreachable resolver yields "unknown". Commit, do NOT push. Report the Vercel setup (new project, KV, PRISM_API_SECRET server-only).
