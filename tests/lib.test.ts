import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEmailFormat, dohLookup, freshness, interpretA, interpretMx, isVerifiedGood, verifyRecord } from "../lib/verify";
import { compareRecords, findClusters, nameSimilarity, normalizeName } from "../lib/dedupe";
import { csvToInputs, parseCsv } from "../lib/csv";
import type { PrismRecord } from "../lib/types";

test("email format", () => {
  assert.equal(checkEmailFormat("a.b+c@sub.example.co"), "ok");
  assert.equal(checkEmailFormat(undefined), "na");
  for (const bad of ["x", "x@", "@x.com", "a@@b.com", "a b@c.com", "a@b", "a..b@c.com", "a(at)b.com", "a@-b.com"]) {
    assert.equal(checkEmailFormat(bad), "bad", bad);
  }
});

test("dns interpretation", () => {
  assert.equal(interpretA(0, ["1.2.3.4"]).status, "ok");
  assert.equal(interpretA(3, []).status, "dead");
  assert.equal(interpretA(0, []).status, "dead");
  assert.equal(interpretA(2, []).status, "unknown");
  assert.equal(interpretA(null, []).status, "unknown");
  assert.equal(interpretMx(0, ["10 mx.x.com."]).status, "ok");
  assert.equal(interpretMx(0, ["0 ."]).status, "none");
  assert.equal(interpretMx(0, []).status, "none");
  assert.equal(interpretMx(3, []).status, "none");
  assert.equal(interpretMx(2, []).status, "unknown");
  assert.equal(interpretMx(null, []).status, "unknown");
});

test("freshness math", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const ok = { email_format: "ok", domain_alive: "ok", email_mx: "ok" } as const;
  assert.equal(freshness("2026-10-14T00:00:00Z", ok, now).score, 100);
  assert.equal(freshness("2026-09-14T00:00:00Z", ok, now).score, 94); // 30 days * 0.2 = 6
  assert.equal(freshness("2020-01-01T00:00:00Z", ok, now).score, 40); // age penalty capped at 60
  const bad = freshness("2026-10-14T00:00:00Z", { email_format: "bad", domain_alive: "dead", email_mx: "none" }, now);
  assert.equal(bad.score, 15);
  assert.equal(bad.rotting, true);
  const unk = freshness("2026-10-14T00:00:00Z", { email_format: "ok", domain_alive: "unknown", email_mx: "unknown" }, now);
  assert.equal(unk.score, 90);
  assert.equal(unk.rotting, false);
  const floor = freshness("2020-01-01T00:00:00Z", { email_format: "bad", domain_alive: "dead", email_mx: "none" }, now);
  assert.equal(floor.score, 0);
  assert.equal(freshness("2026-11-01T00:00:00Z", ok, now).score, 100); // future date does not exceed 100
});

test("verified good", () => {
  assert.equal(isVerifiedGood({ verification: { email_format: "ok", domain_alive: "ok", email_mx: "ok" } }), true);
  assert.equal(isVerifiedGood({ verification: { email_format: "na", domain_alive: "ok", email_mx: "na" } }), true);
  assert.equal(isVerifiedGood({ verification: { email_format: "ok", domain_alive: "unknown", email_mx: "ok" } }), false);
  assert.equal(isVerifiedGood({ verification: { email_format: "ok", domain_alive: "ok", email_mx: "ok" }, duplicate_of: "x" }), false);
});

const rec = (id: string, over: Partial<PrismRecord>): PrismRecord => ({
  id, type: "company", name: id, source: "t", ingested_at: "2026-01-01T00:00:00Z", freshness_score: 100,
  verification: { email_format: "na", domain_alive: "ok", email_mx: "na" }, ...over,
});

test("name similarity", () => {
  assert.equal(normalizeName("Acme Robotics, Inc."), "acme robotics");
  assert.equal(nameSimilarity("Acme Robotics", "ACME Robotics Inc."), 1);
  assert.ok(nameSimilarity("Brightwave Analytics", "Bright Wave Analytics") >= 0.85);
  assert.ok(nameSimilarity("Acme Robotics", "Northgate Logistics") < 0.4);
  assert.equal(nameSimilarity("", "x"), 0);
});

test("dedupe edges", () => {
  const a = rec("a", { name: "Acme Robotics", domain: "acme.com" });
  const b = rec("b", { name: "Acme Robotics Inc", domain: "acme.com" });
  assert.match(compareRecords(a, b)!.reason, /^same domain acme\.com, names 100% similar$/);
  // two different colleagues on one domain are not duplicates
  const p = rec("p", { type: "contact", name: "Dana Whitfield", domain: "acme.com" });
  const q = rec("q", { type: "contact", name: "Marcus Oyelaran", domain: "acme.com" });
  assert.equal(compareRecords(p, q), null);
  // same name at different companies is not a duplicate for contacts
  assert.equal(compareRecords(p, rec("r", { type: "contact", name: "Dana Whitfield", domain: "other.com" })), null);
  // exact email, case-insensitive
  const e = compareRecords(
    rec("e1", { type: "contact", name: "D W", email: "d@x.com" }),
    rec("e2", { type: "contact", name: "Dana W", email: "D@X.com" }),
  )!;
  assert.match(e.reason, /same email d@x\.com/);
  assert.ok(e.confidence >= 0.95);
  // different types never match
  assert.equal(compareRecords(a, rec("c", { type: "contact", name: "Acme Robotics", domain: "acme.com" })), null);
  // fuzzy company names on different domains
  const f = compareRecords(rec("f1", { name: "Brightwave Analytics", domain: "a.io" }), rec("f2", { name: "Bright Wave Analytics", domain: "b.io" }))!;
  assert.match(f.reason, /different domains/);
});

test("clusters group transitively and ids are stable", () => {
  const rs = [
    rec("a", { name: "Acme Robotics", domain: "acme.com" }),
    rec("b", { name: "Acme Robotics Inc", domain: "acme.com" }),
    rec("c", { name: "Acme Robotix", domain: "acme.com" }),
    rec("z", { name: "Zeta Corp", domain: "zeta.com" }),
  ];
  const cl = findClusters(rs);
  assert.equal(cl.length, 1);
  assert.deepEqual([...cl[0]!.record_ids].sort(), ["a", "b", "c"]);
  assert.equal(findClusters([...rs].reverse())[0]!.id, cl[0]!.id);
});

test("csv", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  const rows = csvToInputs("Name,Email,Domain\nAda,ada@x.com,x.com\nAcme,,acme.com\n", "csv:t");
  assert.equal(rows[0]!.type, "contact");
  assert.equal(rows[1]!.type, "company");
  assert.equal(rows[1]!.source, "csv:t");
  assert.throws(() => csvToInputs("foo\nbar\n", "s"));
  assert.throws(() => parseCsv('a\n"open'));
});

test("verifyRecord uses injected resolver; unreachable gives unknown, never ok", async () => {
  const fake: typeof fetch = async (url) => {
    const u = new URL(String(url));
    const name = u.searchParams.get("name");
    const type = u.searchParams.get("type");
    if (name === "gone.invalid") return Response.json({ Status: 3 });
    if (type === "MX") return Response.json({ Status: 0, Answer: [{ type: 15, data: "10 mx.live.test." }] });
    return Response.json({ Status: 0, Answer: [{ type: 1, data: "192.0.2.1" }] });
  };
  const live = await verifyRecord({ domain: "live.test", email: "a@live.test" }, { fetchImpl: fake });
  assert.deepEqual(live.verification, { email_format: "ok", domain_alive: "ok", email_mx: "ok" });
  const dead = await verifyRecord({ domain: "gone.invalid", email: "a@gone.invalid" }, { fetchImpl: fake });
  assert.equal(dead.verification.domain_alive, "dead");
  assert.equal(dead.verification.email_mx, "none");

  const down: typeof fetch = async () => { throw new TypeError("fetch failed"); };
  const unk = await verifyRecord({ domain: "live.test", email: "a@live.test" }, { fetchImpl: down });
  assert.deepEqual(unk.verification, { email_format: "ok", domain_alive: "unknown", email_mx: "unknown" });
  const http500: typeof fetch = async () => new Response("no", { status: 503 });
  assert.equal((await dohLookup("x.com", "A", { fetchImpl: http500 })).rcode, null);
  const garbage: typeof fetch = async () => Response.json({ hello: 1 });
  assert.equal((await verifyRecord({ domain: "x.com" }, { fetchImpl: garbage })).verification.domain_alive, "unknown");
});
