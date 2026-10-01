// Runs this engine against the real conformance vectors in csvx-spec/tests/formulas/ and
// tests/calculations/ — see csvx-spec/AGENTS.md rule 3.4: "every engine must have a thin runner
// that consumes tests/*.json verbatim, performs the named operation, and diffs against expected."
// Before this file, nothing exercised these vectors at all.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateFormula, recalculateCells, type CellMap, type CellValue } from "../calculate.js";

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
  it.each(vectors)("$vector.id ($file)", ({ vector }) => {
    expect(vector.operation).toBe("evaluate");
    const result = evaluateFormula(vector.input.formula, resolveFromCells(vector.input.cells));
    expect(result).toEqual(vector.expected);
  });
});

describeIfSpec("csvx-spec/tests/calculations/*.json", async () => {
  const vectors = await loadVectors(CALCULATIONS_DIR);
  it.each(vectors)("$vector.id ($file)", ({ vector }) => {
    expect(vector.operation).toBe("recalculate");
    const cells: CellMap = {};
    for (const [coordinate, cell] of Object.entries(vector.input.cells as Record<string, any>)) {
      cells[coordinate] = cell.formula ? { formula: cell.formula } : { value: cell.value };
    }
    const result = recalculateCells(cells);
    for (const [coordinate, expected] of Object.entries(vector.expected as Record<string, unknown>)) {
      expect(result[coordinate]).toEqual(expected);
    }
  });
});
