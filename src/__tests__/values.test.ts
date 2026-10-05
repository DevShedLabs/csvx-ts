// Runs csvx-spec/tests/values/resolve.json verbatim (operation "resolve-cell-value") — csvx-spec/
// AGENTS.md rule 3.4: how a CSV field resolves to a typed value.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCellValue } from "../index.js";

const VECTOR = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec", "tests", "values", "resolve.json");
const have = await stat(VECTOR).then(() => true, () => false);

describe.skipIf(!have)("csvx-spec/tests/values/resolve.json (resolve-cell-value)", async () => {
  const cases: any[] = have ? JSON.parse(await readFile(VECTOR, "utf8")).cases : [];
  it("found vectors", () => expect(cases.length).toBeGreaterThan(0));
  it.each(cases.map((c) => [c.note, c]))("%s", (_note, c: any) => {
    const got = resolveCellValue(c.input.raw, c.input.declaredType, c.input.numberFormat);
    expect(JSON.parse(JSON.stringify(got))).toEqual(c.expected);
  });
});
