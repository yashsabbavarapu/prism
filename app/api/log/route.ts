import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const log = await getStore().listLog();
    return NextResponse.json({ log, count: log.length });
  } catch (e) {
    return errorResponse(e);
  }
}
