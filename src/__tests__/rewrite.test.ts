// Engine-specific edge cases for formula rewriting that the shared vectors don't spell out.
import { describe, expect, it } from "vitest";
import { rewriteFormulaForAxisEdit, rewriteFormulaForSheetChange } from "../index.js";
import type { AxisEdit } from "../index.js";

const insertAt3: AxisEdit = { axis: "row", map: (r) => (r >= 3 ? r + 1 : r), deleted: new Set() };

describe("rewriteFormulaForAxisEdit", () => {
  it("never touches string literals, spacing, case or function names", () => {
    expect(rewriteFormulaForAxisEdit('=IF( a3 > 1 , "A3 is big" , LOG10(A4) )', "S", "S", insertAt3)).toBe('=IF( a4 > 1 , "A3 is big" , LOG10(A5) )');
  });
  it("keeps $ markers and rewrites sheet-qualified references only for the target sheet", () => {
    expect(rewriteFormulaForAxisEdit("=$A$3+Other!A3+'My Sheet'!B$4", "S", "My Sheet", insertAt3)).toBe("=$A$3+Other!A3+'My Sheet'!B$5");
  });
  it("leaves an unparseable formula alone", () => {
    expect(rewriteFormulaForAxisEdit("=A3+", "S", "S", insertAt3)).toBe("=A3+");
  });
});

describe("rewriteFormulaForSheetChange", () => {
  it("quotes only when the new name needs it, and rewrites both ends of a range", () => {
    expect(rewriteFormulaForSheetChange("=SUM(Sales!A1:Sales!B2)", "Sales", "Q1 Sales")).toBe("=SUM('Q1 Sales'!A1:'Q1 Sales'!B2)");
    expect(rewriteFormulaForSheetChange("='Q1 Sales'!A1", "Q1 Sales", "Totals")).toBe("=Totals!A1");
  });
  it("turns a whole sheet-qualified range into #REF! on delete", () => {
    expect(rewriteFormulaForSheetChange("=SUM(Sales!A1:B2)+C1", "Sales", undefined)).toBe("=SUM(#REF!)+C1");
  });
});
