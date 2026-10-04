// Runs csvx-spec/tests/print/pagination.json verbatim (operation "paginate") — csvx-spec/AGENTS.md
// rule 3.4. The vector describes a sheet compactly (column widths, a record count, sparse text
// values); this materializes it and compares the pages, scale, area, and printable size.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { columnIndexFromId, paginate } from "../index.js";
import type { Sheet } from "../index.js";

const VECTOR = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec", "tests", "print", "pagination.json");
const have = await stat(VECTOR).then(() => true, () => false);

function sheetFrom(input: any): Sheet {
  const columns = input.sheet.columns;
  const records: string[][] = Array.from({ length: input.sheet.recordCount }, () => columns.map(() => ""));
  for (const [coordinate, text] of Object.entries<string>(input.sheet.values ?? {})) {
    const match = /^([A-Z]+)(\d+)$/.exec(coordinate) as RegExpExecArray;
    const row = Number(match[2]) - 2;
    if (row >= 0) (records[row] as string[])[columnIndexFromId(match[1] as string)] = text;
  }
  return {
    id: "sheet-1",
    name: "Sheet1",
    path: "sheets/sheet-1.csv",
    columns,
    records,
    cells: input.sheet.cells ?? {},
    rowHeights: input.sheet.rowHeights ? Object.fromEntries(Object.entries(input.sheet.rowHeights).map(([k, v]) => [Number(k), v as number])) : undefined,
    print: input.print,
  };
}

describe.skipIf(!have)("csvx-spec/tests/print/pagination.json", async () => {
  const vector = have ? JSON.parse(await readFile(VECTOR, "utf8")) : { cases: [] };
  it.each(vector.cases.map((c: any, i: number) => [`#${i + 1}: ${c.note}`, c]))("%s", (_name, c: any) => {
    const result = paginate(sheetFrom(c.input), c.input.styles);
    const e = c.expected;
    if (e.pages) expect(result.pages.map(({ rows, columns }) => ({ rows, columns }))).toEqual(e.pages);
    if (e.scale !== undefined) expect(result.scale).toBeCloseTo(e.scale, 9);
    if (e.area !== undefined) expect(result.area).toBe(e.area);
    if (e.printable) {
      expect(result.printable.width).toBeCloseTo(e.printable.width, 6);
      expect(result.printable.height).toBeCloseTo(e.printable.height, 6);
    }
    expect(result.pages.map((p) => p.number)).toEqual(result.pages.map((_, i) => i + 1));
  });
});
