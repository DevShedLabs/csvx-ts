// Row and coordinate conventions, defined by csvx-spec/spec/03-sheets.md: the CSV header is row 1
// and data records start at row 2, everywhere A1 coordinates are used (formulas, `cells` keys,
// `rowHeights` keys, print settings). A row is addressed here by its *record index*, so the header
// row is HEADER_ROW (-1) and record i is row i + 2. Every consumer of the engine goes through these
// helpers instead of re-deriving the offset, which is how an off-by-one once shipped unnoticed.

import { columnId, columnIndexFromId } from "./columns.js";
import type { Sheet } from "./model.js";

/** The record index of the CSV header row (spec row 1). */
export const HEADER_ROW = -1;

/** Spec row number (1-based, header = 1) for a record index. */
export function rowNumberFor(rowIndex: number): number {
  return rowIndex + 2;
}

/** Record index for a spec row number; row 1 (the header) is HEADER_ROW. */
export function rowIndexFor(rowNumber: number): number {
  return rowNumber - 2;
}

/** The A1 coordinate of a cell, e.g. coordinateFor(0, HEADER_ROW) is "A1" and coordinateFor(2, 0) is "C2". */
export function coordinateFor(columnIndex: number, rowIndex: number): string {
  return `${columnId(columnIndex)}${rowNumberFor(rowIndex)}`;
}

/** Inverse of coordinateFor: "AB12" → zero-based column and record row index ("A1" has row HEADER_ROW).
 * An unparseable coordinate yields the first record cell, matching the previous consumer behavior. */
export function indicesForCoordinate(coordinate: string): { column: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/.exec(coordinate);
  if (!match) return { column: 0, row: 0 };
  return { column: columnIndexFromId(match[1] as string), row: rowIndexFor(Number(match[2])) };
}

/** A cell's raw text. For the header row that is the column name, except that a name equal to the
 * column's own letter is the placeholder an importer writes for an empty header cell
 * (spec/14-xlsx-interoperability.md, 14.7) and reads as blank. */
export function rawCellText(sheet: Pick<Sheet, "columns" | "records"> | undefined, row: number, column: number): string {
  if (row < 0) {
    const name = sheet?.columns?.[column]?.name ?? "";
    return name === columnId(column) ? "" : name;
  }
  return sheet?.records?.[row]?.[column] ?? "";
}
