# Prism v1

Verifies records with live DNS-over-HTTPS checks, proposes merges for duplicates with plain-word reasons, and keeps a ledger of enrichment spend.

- Spec: `../files/prism-functional-spec.md`. Conventions: `../files/build-conventions.md`.
- `npm run dev`, `npm run build`, `npm test` (unit tests for format, freshness, dedupe, CSV, resolver handling).
- Writes: `POST /api/records`, `/api/records/[id]/verify`, `/api/merges/[id]/decision`, `/api/spend`. Gated by `PRISM_API_SECRET` via the `x-prism-secret` header when set. 30 requests per minute per IP on records, verify and spend.
- Reads: `GET /api/records?status=all|needs_review|rotting|duplicates`, `/api/merges?status=`, `/api/spend`, `/api/log`.
- The UI's writes are server actions, so the secret never reaches the browser.
- Spec additions: `email_mx` can be `na` (no email on the record); `POST /api/merges/[id]/decision` accepts an optional `keep` record id.

## Vercel
1. New project from this repo (root directory `prism` if it lives in a monorepo). Framework: Next.js.
2. Storage: create a KV database (Upstash for Redis via the Marketplace) and connect it to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. Environment variable `PRISM_API_SECRET` (server only, do not prefix with `NEXT_PUBLIC_`), production and preview.
4. Deploy. The first request seeds 20 sample records and runs their DNS checks.
