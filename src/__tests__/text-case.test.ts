// Runs csvx-spec/tests/edit/text-case.json verbatim (operation "change-case").
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changeCase } from "../index.js";
import type { TextCaseMode } from "../index.js";
import type { ScalarType } from "../model.js";

const VECTOR = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec", "tests", "edit", "text-case.json");
const have = await stat(VECTOR).then(
  () => true,
  () => false,
);

interface Case {
  input: { mode: TextCaseMode; text: string; declaredType?: ScalarType; formula?: string; header?: boolean };
  expected: string;
}

describe.skipIf(!have)("csvx-spec/tests/edit/text-case.json", () => {
  it("every case", async () => {
    const vector = JSON.parse(await readFile(VECTOR, "utf8")) as { cases: Case[] };
    expect(vector.cases.length).toBeGreaterThan(0);
    for (const { input, expected } of vector.cases) {
      expect(changeCase(input.text, input.mode, { declaredType: input.declaredType, formula: input.formula, header: input.header }), JSON.stringify(input)).toBe(expected);
    }
  });
});
