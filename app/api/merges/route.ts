import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { HttpError } from "@/lib/service";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const status = new URL(req.url).searchParams.get("status");
    if (status && !["pending", "accepted", "rejected"].includes(status)) {
      throw new HttpError(400, "status must be one of: pending, accepted, rejected.");
    }
    const all = await getStore().listMerges();
    const merges = status ? all.filter((m) => m.status === status) : all;
    return NextResponse.json({ merges, count: merges.length });
  } catch (e) {
    return errorResponse(e);
  }
}
