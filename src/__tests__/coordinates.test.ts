// Conformance for the row convention in csvx-spec/spec/03-sheets.md: the CSV header is row 1 and
// data records start at row 2. Uses the real golden fixture examples/formulas.csvx, whose formulas
// (`=A2*B2` on C2, `=SUM(C2:C3)` on C4) are only correct under that convention — under the old
// "A1 is the first record" mapping they would read the wrong rows.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER_ROW, buildCellMap, coordinateFor, indicesForCoordinate, rawCellText, recalculateWorkbook, rowIndexFor, rowNumberFor } from "../index.js";
import { openDirectory } from "../node.js";

const SPEC_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "csvx-spec");
const formulasFixture = () => openDirectory(path.join(SPEC_ROOT, "examples", "formulas.csvx"));

describe("row and coordinate convention", () => {
  it("numbers the header row 1 and the first record row 2", () => {
    expect(rowNumberFor(HEADER_ROW)).toBe(1);
    expect(rowNumberFor(0)).toBe(2);
    expect(rowIndexFor(1)).toBe(HEADER_ROW);
    expect(coordinateFor(0, HEADER_ROW)).toBe("A1");
    expect(coordinateFor(2, 0)).toBe("C2");
    expect(coordinateFor(26, 9)).toBe("AA11");
  });

  it("round-trips coordinates", () => {
    for (const [column, row] of [[0, HEADER_ROW], [0, 0], [2, 1], [26, 998]] as const) {
      expect(indicesForCoordinate(coordinateFor(column, row))).toEqual({ column, row });
    }
  });

  it("reads the header row as the column names, and a name equal to its own letter as blank", async () => {
    const workbook = await openDirectory(path.join(SPEC_ROOT, "examples", "formulas.csvx"));
    const sheet = workbook.sheets[0]!;
    expect(rawCellText(sheet, HEADER_ROW, 0)).toBe("Quantity");
    expect(rawCellText(sheet, 0, 0)).toBe("2");
    const placeholder = { ...sheet, columns: sheet.columns.map((column) => ({ ...column, name: column.id })) };
    expect(rawCellText(placeholder, HEADER_ROW, 1)).toBe("");
  });
});

describe("golden fixture formulas under the convention", () => {
  it("includes the header in the cell map, so A1 is text and A2 is the first record", async () => {
    const workbook = await formulasFixture();
    const map = buildCellMap(workbook.sheets[0]!, workbook.styles);
    expect(map.A1?.value).toMatchObject({ type: "string", value: "Quantity" });
    expect(map.A2?.value).toMatchObject({ type: "integer", value: 2 });
    expect(map.C2?.formula).toBe("=A2*B2");
  });

  it("evaluates =A2*B2 and =SUM(C2:C3) against the right rows", async () => {
    const workbook = await formulasFixture();
    const recalculated = recalculateWorkbook(workbook);
    const sheet = recalculated.sheets[0]!;
    // Records: row 2 (2 × 4.50), row 3 (3 × 2.00), row 4 (the SUM row). Same values the fixture caches.
    expect(sheet.records.map((row) => row[2])).toEqual(["9.00", "6.00", "15.00"]);
    expect(sheet.cells?.C2?.cached).toMatchObject({ type: "decimal", value: "9.00" });
    expect(sheet.cells?.C4?.cached).toMatchObject({ type: "decimal", value: "15.00" });
  });
});
