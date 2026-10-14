"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clientIp, rateLimited } from "@/lib/api";
import { csvToInputs } from "@/lib/csv";
import { decideMerge, HttpError, ingestRecords, logSpend, reverify } from "@/lib/service";

// These actions run on the server and call the service directly, so the API secret
// never reaches the browser. Anyone who can load the UI can use them; that is the
// trade the build conventions accept for in-app writes.

function back(path: string, key: "msg" | "err", text: string): never {
  revalidatePath("/", "layout");
  redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`);
}

async function guard<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) back(path, "err", e.message);
    throw e;
  }
}

export async function uploadCsv(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back("/records", "err", "Choose a CSV file first.");
  if (file.size > 1_000_000) back("/records", "err", "CSV is larger than 1 MB.");
  const result = await guard("/records", async () => {
    if (await rateLimited(clientIp(new Request("http://x", { headers: headers() })))) {
      throw new HttpError(429, "Rate limit: 30 requests per minute. Wait a minute and retry.");
    }
    let inputs;
    try {
      inputs = csvToInputs(await file.text(), `csv:${file.name}`);
    } catch (e) {
      throw new HttpError(400, e instanceof Error ? e.message : "Could not read the CSV.");
    }
    return ingestRecords(inputs);
  });
  back("/records", "msg", `Added ${result.records.length} records, verified live. ${result.proposals.length} new merge proposals.`);
}

export async function verifyAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const path = `/records/${encodeURIComponent(id)}`;
  await guard(path, () => reverify(id));
  back(path, "msg", "Checks re-run live.");
}

export async function decideAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const keep = formData.get("keep");
  await guard("/duplicates", () => decideMerge(id, { decision, ...(keep ? { keep: String(keep) } : {}) }));
  back("/duplicates", "msg", decision === "accept" ? "Merge accepted. Duplicates are now excluded from lists." : "Proposal dismissed.");
}

export async function spendAction(formData: FormData) {
  const body = {
    record_id: String(formData.get("record_id") ?? ""),
    vendor: String(formData.get("vendor") ?? ""),
    credits: Number(formData.get("credits")),
    note: String(formData.get("note") ?? ""),
  };
  await guard("/economics", async () => {
    if (await rateLimited(clientIp(new Request("http://x", { headers: headers() })))) {
      throw new HttpError(429, "Rate limit: 30 requests per minute. Wait a minute and retry.");
    }
    return logSpend(body);
  });
  back("/economics", "msg", "Spend logged.");
}
