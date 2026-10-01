// Mirrors csvx-go's layout_test.go case for case — both engines must agree on this formula (see
// spec/03-sheets.md and layout.ts's comment for why).

import { describe, expect, it } from "vitest";
import { columnWidthToPixels, pixelsToColumnWidth, pixelsToRowHeight, rowHeightToPixels } from "../layout.js";

describe("column width <-> pixels", () => {
  it("matches the real example.csvx fixture's Column A width (26.25 -> 189px, per App.jsx's prior formula)", () => {
    expect(columnWidthToPixels(26.25)).toBe(189);
  });

  it("round-trips a pixel resize back to a character-width unit", () => {
    expect(pixelsToColumnWidth(189)).toBeCloseTo(26.29, 1);
    expect(columnWidthToPixels(pixelsToColumnWidth(150))).toBe(150);
  });
});

describe("row height <-> pixels", () => {
  it("matches XLSX's default row height (15pt -> 20px)", () => {
    expect(rowHeightToPixels(15)).toBe(20);
  });

  it("round-trips a pixel resize back to points", () => {
    expect(pixelsToRowHeight(20)).toBeCloseTo(15, 1);
    expect(rowHeightToPixels(pixelsToRowHeight(28))).toBe(28);
  });
});
