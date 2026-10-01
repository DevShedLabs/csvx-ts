// Canonical unit conversions for Column.width and Sheet.rowHeights, per spec/03-sheets.md. These
// fields have a real, specific unit (XLSX character-width units for width; points for row height —
// not arbitrary, and not pixels), because that's what every real producer of this data already
// emits (an XLSX import copies the source file's values verbatim, in those units). A pixel-based
// renderer (csvx-web) must convert through these functions rather than inventing its own formula —
// see csvx-spec/AGENTS.md rule 5.2: a consumer app doesn't get a second opinion about what a CSVX
// value means, and two engines disagreeing on this formula would make a width one tool wrote round-
// trip to a visibly different column in another.
//
// Neither conversion is exact — real glyph widths vary slightly by character and by font — but both
// directions use the same standard Calibri-11 approximation Excel itself is built around, so a
// width/height round-trips predictably through any engine that implements this file's contract.

/** Converts an XLSX character-width unit (Column.width) to CSS pixels. */
export function columnWidthToPixels(width: number): number {
  return Math.round(width * 7 + 5);
}

/** Converts CSS pixels back to an XLSX character-width unit, for writing back a pixel-based
 * resize — the inverse of columnWidthToPixels. Rounded to 2 decimal places, since XLSX widths are
 * themselves fractional (e.g. 26.25) and an unrounded float would add visual noise to the file
 * for no benefit (sub-hundredth-of-a-character precision isn't meaningful to any renderer). */
export function pixelsToColumnWidth(pixels: number): number {
  return Math.round(((pixels - 5) / 7) * 100) / 100;
}

/** Converts a row height in points (Sheet.rowHeights) to CSS pixels, at the standard 96 DPI /
 * 72-points-per-inch ratio every renderer (and XLSX itself) assumes. */
export function rowHeightToPixels(points: number): number {
  return Math.round((points * 4) / 3);
}

/** Converts CSS pixels back to points — the inverse of rowHeightToPixels. */
export function pixelsToRowHeight(pixels: number): number {
  return Math.round(((pixels * 3) / 4) * 100) / 100;
}
