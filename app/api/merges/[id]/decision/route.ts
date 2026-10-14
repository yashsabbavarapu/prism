import { handleWrite, readJson } from "@/lib/api";
import { decideMerge } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleWrite(req, {}, async () => ({ body: { merge: await decideMerge(params.id, await readJson(req)) } }));
}
