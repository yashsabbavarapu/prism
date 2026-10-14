import { handleWrite } from "@/lib/api";
import { reverify } from "@/lib/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  return handleWrite(req, { limited: true }, async () => ({ body: { record: await reverify(params.id) } }));
}
