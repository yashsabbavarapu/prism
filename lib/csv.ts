/** Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF or LF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quote in CSV.");
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const COLUMNS = ["id", "type", "name", "domain", "email", "title", "source", "ingested_at"] as const;

/**
 * Turn CSV text into record inputs. Header row required. Unknown columns are ignored.
 * `type` defaults to contact when an email is present, else company. `source` defaults to the given label.
 */
export function csvToInputs(text: string, defaultSource: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  if (!header.includes("name")) throw new Error('CSV header must include a "name" column.');
  return rows.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    for (const col of COLUMNS) {
      const idx = header.indexOf(col);
      const v = idx >= 0 ? (cells[idx] ?? "").trim() : "";
      if (v) o[col] = v;
    }
    o.type = (o.type ?? (o.email ? "contact" : "company")).toLowerCase();
    o.source = o.source ?? defaultSource;
    return o;
  });
}
