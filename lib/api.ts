// Shared-secret auth and per-IP rate limit for the write routes.
//
// PRISM_API_SECRET (server only): when set, writes must send a matching `x-prism-secret` header or get a 401.
//   When unset (local dev), writes are open and the UI shows a notice.
// The in-app UI never sends the secret; its writes are server actions that run on the server.
// GET routes stay open.
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getStore } from "./store";
import { HttpError } from "./service";

export const AUTH_HEADER = "x-prism-secret";
export const RATE_LIMIT = 30;
export const RATE_WINDOW_SEC = 60;

export const writesAuthenticated = () => Boolean(process.env.PRISM_API_SECRET);

function authorized(req: Request): boolean {
  const secret = process.env.PRISM_API_SECRET;
  if (!secret) return true;
  const given = Buffer.from(req.headers.get(AUTH_HEADER) ?? "");
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Returns seconds to wait when over the limit, else 0. */
export async function rateLimited(ip: string): Promise<number> {
  const n = await getStore().hit(`ingest:${ip}`, RATE_WINDOW_SEC);
  return n > RATE_LIMIT ? RATE_WINDOW_SEC : 0;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
}

interface WriteOpts {
  /** Count against the 30/min per-IP ingest limit. */
  limited?: boolean;
}

export async function handleWrite(req: Request, opts: WriteOpts, fn: () => Promise<{ status?: number; body: unknown }>): Promise<NextResponse> {
  try {
    if (!authorized(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    if (opts.limited) {
      const wait = await rateLimited(clientIp(req));
      if (wait) {
        return NextResponse.json({ error: "Rate limit: 30 requests per minute." }, { status: 429, headers: { "Retry-After": String(wait) } });
      }
    }
    const { status, body } = await fn();
    return NextResponse.json(body, { status: status ?? 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Internal error." }, { status: 500 });
}
