import { NextResponse } from "next/server";
import { errorResponse, handleWrite, readJson } from "@/lib/api";
import { economics, logSpend } from "@/lib/service";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [spend, summary] = await Promise.all([getStore().listSpend(), economics()]);
    return NextResponse.json({ spend, summary });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  return handleWrite(req, { limited: true }, async () => ({ status: 201, body: { spend: await logSpend(await readJson(req)) } }));
}
