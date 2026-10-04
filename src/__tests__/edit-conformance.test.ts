// Runs csvx-spec/tests/edit/*.json (except text-case, which has its own runner), plus the
// parse-formula vectors in tests/invalid/, verbatim against this engine — csvx-spec/AGENTS.md rule
// 3.4. Edit operations are run with recalculation off, because the vectors compare the model as the
// operation leaves it (spec/15-edit-operations.md).
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  InvalidEditError,
  FormulaParseError,
  addSheet,
  applyStyle,
  clearStyle,
  deleteColumns,
  deleteRows,
  deleteSheet,
  insertColumns,
  insertRows,
  paste,
  parseFormula,
  renameSheet,
  setCell,
  setPrint,
  evaluateFormula,
} from "../index.js";
import type { Workbook } from "../index.js";

const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const EDIT_DIR = path.join(SPEC_ROOT, "tests", "edit");
const INVALID_DIR = path.join(SPEC_ROOT, "tests", "invalid");

const have = await stat(EDIT_DIR).then(
  () => true,
  () => false,
);

interface Case {
  note?: string;
  operation?: string;
  input: { workbook: any; args: Record<string, any> };
  expected: Record<string, any>;
}

async function loadCases(dir: string, skip: string[]): Promise<Array<{ name: string; operation: string; case: Case }>> {
  const out = [];
  for (const file of (await readdir(dir)).sort()) {
    if (!file.endsWith(".json") || skip.includes(file)) continue;
    const vector = JSON.parse(await readFile(path.join(dir, file), "utf8"));
    for (const [i, c] of (vector.cases as Case[]).entries()) out.push({ name: `${vector.id} #${i + 1}: ${c.note ?? ""}`, operation: c.operation ?? vector.operation, case: c });
  }
  return out;
}

function toWorkbook(input: any): Workbook {
  return {
    id: "book-1",
    version: "1.0",
    ...input,
    sheets: input.sheets.map((sheet: any) => ({ path: `sheets/${sheet.id}.csv`, ...sheet })),
  };
}

const OFF = { recalculate: false };

function run(operation: string, workbook: Workbook, a: Record<string, any>): Workbook {
  switch (operation) {
    case "insert-rows":
      return insertRows(workbook, a.sheet, a.at, a.count, OFF);
    case "delete-rows":
      return deleteRows(workbook, a.sheet, a.rows, OFF);
    case "insert-columns":
      return insertColumns(workbook, a.sheet, a.at, a.count, OFF);
    case "delete-columns":
      return deleteColumns(workbook, a.sheet, a.columns, OFF);
    case "add-sheet":
      return addSheet(workbook, OFF);
    case "rename-sheet":
      return renameSheet(workbook, a.sheet, a.name, OFF);
    case "delete-sheet":
      return deleteSheet(workbook, a.sheet, OFF);
    case "set-cell":
      return setCell(workbook, a.sheet, a.coordinate, a.text, OFF);
    case "paste":
      return paste(workbook, a.sheet, a.anchor, a.rows, OFF);
    case "apply-style":
      return applyStyle(workbook, a.sheet, a.coordinates, a.patch, OFF);
    case "clear-style":
      return clearStyle(workbook, a.sheet, a.coordinates, OFF);
    case "set-print":
      return setPrint(workbook, a.sheet, a.patch, OFF);
    default:
      throw new Error(`runner does not know operation ${operation}`);
  }
}

function formulasOf(sheet: any): Record<string, string> {
  return Object.fromEntries(Object.entries<any>(sheet.cells ?? {}).filter(([, m]) => m.formula).map(([k, m]) => [k, m.formula]));
}

describe.skipIf(!have)("csvx-spec/tests/edit/*.json", async () => {
  const cases = have ? await loadCases(EDIT_DIR, ["text-case.json"]) : [];
  it("found vectors", () => expect(cases.length).toBeGreaterThan(0));
  it.each(cases)("$name", ({ operation, case: c }) => {
    const workbook = toWorkbook(c.input.workbook);
    if (c.expected.valid === false) {
      expect(() => run(operation, workbook, c.input.args)).toThrow(InvalidEditError);
      return;
    }
    const result = run(operation, workbook, c.input.args);
    const e = c.expected;
    const targetId = operation === "add-sheet" ? (result.sheets[result.sheets.length - 1] as any).id : (result.sheets.find((s) => s.id === c.input.args.sheet || s.name === c.input.args.sheet) ?? result.sheets[0]!).id;
    const target: any = result.sheets.find((s) => s.id === targetId);
    const perSheet = (value: any, pick: (sheet: any) => unknown) => {
      const keyed = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((k) => result.sheets.some((s) => s.id === k));
      if (keyed) for (const [id, expected] of Object.entries(value)) expect(pick(result.sheets.find((s) => s.id === id)), id).toEqual(expected);
      else expect(pick(target)).toEqual(value);
    };
    if ("formulas" in e) perSheet(e.formulas, formulasOf);
    if ("columns" in e) perSheet(e.columns, (s) => s.columns);
    if ("records" in e) expect(target.records).toEqual(e.records);
    if ("cells" in e) expect(target.cells).toEqual(e.cells);
    if ("namedRanges" in e) expect(result.namedRanges).toEqual(e.namedRanges);
    if ("validationFormulas" in e) {
      const validationFormulas = (sheet: any) =>
        Object.fromEntries(Object.entries<any>(sheet.cells ?? {}).filter(([, m]) => m.validation?.formula1 || m.validation?.formula2).map(([k, m]) => [k, m.validation.formula1 ?? m.validation.formula2]));
      perSheet(e.validationFormulas, validationFormulas);
    }
    if ("styles" in e) expect(result.styles).toEqual(e.styles);
    if ("print" in e) expect(target.print ?? null).toEqual(e.print);
    if ("names" in e) expect(result.sheets.map((s) => s.name)).toEqual(e.names);
    if ("newSheet" in e) {
      expect(target.columns).toEqual(e.newSheet.columns);
      expect(target.records).toEqual(e.newSheet.records);
    }
    if (e.idUnique) expect(new Set(result.sheets.map((s) => s.id)).size).toBe(result.sheets.length);
    if (e.nameUnique) expect(new Set(result.sheets.map((s) => s.name)).size).toBe(result.sheets.length);
    // Edits never mutate their input.
    expect(workbook).toEqual(toWorkbook(c.input.workbook));
  });
});

describe.skipIf(!have)("csvx-spec/tests/invalid parse-formula vectors", async () => {
  const entries = (await readdir(INVALID_DIR)).filter((f) => f.endsWith(".json")).sort();
  const vectors = [];
  for (const file of entries) vectors.push(JSON.parse(await readFile(path.join(INVALID_DIR, file), "utf8")));
  const parseVectors = vectors.filter((v) => v.operation === "parse-formula");
  it.each(parseVectors)("$id", (vector) => {
    const expectedCodes = (vector.expected.errors ?? []).map((e: any) => e.code);
    if (expectedCodes.includes("NAME")) {
      expect(evaluateFormula(vector.input, () => ({ type: "blank" }))).toMatchObject({ type: "error", code: "NAME" });
    } else {
      expect(vector.expected.valid).toBe(false);
      expect(() => parseFormula(vector.input)).toThrow(FormulaParseError);
    }
  });
});
