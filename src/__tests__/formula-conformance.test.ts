// Runs this engine against the real conformance vectors in csvx-spec/tests/formulas/ and
// tests/calculations/ — see csvx-spec/AGENTS.md rule 3.4: "every engine must have a thin runner
// that consumes tests/*.json verbatim, performs the named operation, and diffs against expected."
// Before this file, nothing exercised these vectors at all.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateFormula, recalculateCells, recalculateSheets, type CellMap, type CellValue } from "../calculate.js";

const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const FORMULAS_DIR = path.join(SPEC_ROOT, "tests", "formulas");
const CALCULATIONS_DIR = path.join(SPEC_ROOT, "tests", "calculations");

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function loadVectors(dir: string): Promise<Array<{ file: string; vector: any }>> {
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir);
  const vectors = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const contents = await readFile(path.join(dir, entry), "utf8");
    vectors.push({ file: entry, vector: JSON.parse(contents) });
  }
  return vectors;
}

function resolveFromCells(cells: Record<string, { type: string; value?: unknown }> | undefined) {
  return (ref: { column: string; row: number }): CellValue => {
    const coordinate = `${ref.column}${ref.row + 1}`;
    const cell = cells?.[coordinate];
    if (!cell) return { type: "blank" };
    return cell as CellValue;
  };
}

const haveSpecChecked = await exists(FORMULAS_DIR);
const describeIfSpec = haveSpecChecked ? describe : describe.skip;

describeIfSpec("csvx-spec/tests/formulas/*.json", async () => {
  const vectors = await loadVectors(FORMULAS_DIR);
  // A vector is either one case (input/expected at the top level) or a `cases` array of them.
  const cases = vectors.flatMap(({ file, vector }) =>
    (vector.cases ?? [{ input: vector.input, expected: vector.expected }]).map((c: any, i: number) => ({ file, id: `${vector.id}#${i + 1}`, operation: vector.operation, c })),
  );
  it.each(cases)("$id ($file)", ({ operation, c }) => {
    expect(operation).toBe("evaluate");
    expect(evaluateFormula(c.input.formula, resolveFromCells(c.input.cells))).toEqual(c.expected);
  });
});

function toCellMap(cells: Record<string, any>): CellMap {
  const map: CellMap = {};
  for (const [coordinate, cell] of Object.entries(cells)) {
    // Older vectors wrap a typed value as {"value": {...}}; newer ones give the typed value itself.
    map[coordinate] = cell.formula ? { formula: cell.formula } : { value: cell.type ? cell : cell.value };
  }
  return map;
}

describeIfSpec("csvx-spec/tests/calculations/*.json", async () => {
  const vectors = await loadVectors(CALCULATIONS_DIR);
  const cases = vectors.flatMap(({ file, vector }) =>
    (vector.cases ?? [vector]).map((c: any, i: number) => ({ file, id: `${vector.id}#${i + 1}`, operation: vector.operation, c })),
  );
  it.each(cases)("$id ($file)", ({ operation, c }) => {
    if (operation === "recalculate-workbook") {
      const sheets: Record<string, CellMap> = {};
      for (const [name, cells] of Object.entries(c.input.sheets as Record<string, any>)) sheets[name] = toCellMap(cells);
      const result = recalculateSheets(sheets, undefined, c.input.namedRanges);
      for (const [name, expected] of Object.entries(c.expected as Record<string, Record<string, unknown>>)) {
        for (const [coordinate, value] of Object.entries(expected)) expect(result[name]?.[coordinate], `${name}!${coordinate}`).toEqual(value);
      }
      return;
    }
    expect(operation).toBe("recalculate");
    const result = recalculateCells(toCellMap(c.input.cells));
    for (const [coordinate, expected] of Object.entries(c.expected as Record<string, unknown>)) expect(result[coordinate], coordinate).toEqual(expected);
  });
});
