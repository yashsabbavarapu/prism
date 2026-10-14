import { NextResponse } from "next/server";
import { errorResponse, handleWrite, readJson } from "@/lib/api";
import { HttpError, ingestRecords, listRecordViews, STATUS_FILTERS, type StatusFilter } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const status = new URL(req.url).searchParams.get("status") ?? "all";
    if (!STATUS_FILTERS.includes(status as StatusFilter)) {
      throw new HttpError(400, `status must be one of: ${STATUS_FILTERS.join(", ")}.`);
    }
    const records = await listRecordViews(status as StatusFilter);
    return NextResponse.json({ records, count: records.length });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Single record object, or an array (batch, all or nothing). */
export async function POST(req: Request) {
  return handleWrite(req, { limited: true }, async () => {
    const body = await readJson(req);
    const list = Array.isArray(body) ? body : [body];
    const { records, proposals } = await ingestRecords(list);
    return { status: 201, body: Array.isArray(body) ? { records, proposals } : { record: records[0], proposals } };
  });
}
