import { describe, expect, it } from "vitest";
import { insertRows, setCell, validateWorkbook } from "../index.js";
import type { Workbook } from "../index.js";

const workbook: Workbook = {
  id: "book-1",
  version: "1.0",
  sheets: [{ id: "sheet-1", name: "Sheet1", path: "sheets/sheet-1.csv", columns: [{ id: "A", name: "A" }], records: [["1"], ["2"]], cells: {} }],
};

describe("validateWorkbook (unsaved, in memory)", () => {
  it("accepts an edited workbook that was never saved", async () => {
    const edited = setCell(insertRows(workbook, "sheet-1", 2, 1), "sheet-1", "A3", "=A4");
    expect(await validateWorkbook(edited)).toEqual({ valid: true, errors: [], warnings: [] });
  });
  it("reports a structural problem", async () => {
    const result = await validateWorkbook({ ...workbook, sheets: [] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBeDefined();
  });
  it("reports an invalid named range", async () => {
    const result = await validateWorkbook({ ...workbook, namedRanges: [{ name: "A1", refersTo: "=Sheet1!$A$1" }] });
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.code).toBe("INVALID_NAMED_RANGE");
  });
});
