// Workbook-level recalculation: gathers each sheet's cells into the coordinate map recalculateCells
// (calculate.ts) evaluates, then writes results back as each formula cell's `cached` value and its
// visible CSV text. This is the one place the sheet → coordinate mapping happens (see
// coordinates.ts), so formulas always see the cells the spec says they reference.

import { recalculateSheets } from "./calculate.js";
import type { CellMap, CellValue } from "./calculate.js";
import { HEADER_ROW, coordinateFor, indicesForCoordinate, rawCellText } from "./coordinates.js";
import { resolveCellValue } from "./model.js";
import type { Sheet, Style, Value, Workbook } from "./model.js";

/** Converts a formula result back to the raw text the sheet CSV stores — spec/03-sheets.md: the CSV
 * holds the cache, not a formatted-for-display string. */
export function canonicalCellText(value: CellValue | Value | undefined): string {
  if (!value || value.type === "blank") return "";
  if (value.type === "error") return `#${value.code}`;
  if (value.type === "boolean") return value.value ? "true" : "false";
  return String(value.value ?? "");
}

function numberFormatFor(styles: Style[] | undefined, id: string | undefined): string | undefined {
  return id ? styles?.find((style) => style.id === id)?.numberFormat : undefined;
}

/** Builds the flat coordinate → {formula | value} map recalculateCells expects for one sheet. Every
 * cell gets an entry (not just formula cells) so a formula can resolve a plain cell it references,
 * including a header cell, whose value is its text. resolveCellValue decides a plain cell's type
 * from its own declared type, its column's, or its style's numberFormat. */
export function buildCellMap(sheet: Sheet, styles?: Style[]): CellMap {
  const cells: CellMap = {};
  sheet.columns.forEach((_, columnIndex) => {
    cells[coordinateFor(columnIndex, HEADER_ROW)] = { value: resolveCellValue(rawCellText(sheet, HEADER_ROW, columnIndex), "string") as CellValue };
  });
  sheet.records.forEach((row, rowIndex) => {
    row.forEach((raw, columnIndex) => {
      const coordinate = coordinateFor(columnIndex, rowIndex);
      const metadata = sheet.cells?.[coordinate];
      if (metadata?.formula) {
        cells[coordinate] = { formula: metadata.formula };
        return;
      }
      const declaredType = metadata?.type || sheet.columns[columnIndex]?.type;
      cells[coordinate] = { value: resolveCellValue(raw, declaredType, numberFormatFor(styles, metadata?.style)) as CellValue };
    });
  });
  return cells;
}

/** Recalculates every formula cell in every sheet. Cross-sheet references resolve against each other
 * sheet's own cell map by name. Returns a new workbook; call it after anything that can change what
 * a formula sees (a cell edit, a row/column insert or delete) and once on load, to cover a formula
 * authored by another tool with a stale or missing cache. */
export function recalculateWorkbook(workbook: Workbook): Workbook {
  const cellMapsByName: Record<string, CellMap> = {};
  for (const sheet of workbook.sheets) cellMapsByName[sheet.name] = buildCellMap(sheet, workbook.styles);
  const resultsByName = recalculateSheets(cellMapsByName, undefined, workbook.namedRanges);
  const sheets = workbook.sheets.map((sheet) => {
    const results = resultsByName[sheet.name] as Record<string, CellValue>;
    if (Object.keys(results).length === 0) return sheet;
    const records = sheet.records.map((row) => [...row]);
    const cells = { ...sheet.cells };
    for (const [coordinate, value] of Object.entries(results)) {
      const { row, column } = indicesForCoordinate(coordinate);
      const record = records[row];
      if (!record) continue;
      record[column] = canonicalCellText(value);
      cells[coordinate] = { ...cells[coordinate], cached: value as Value };
    }
    return { ...sheet, records, cells };
  });
  return { ...workbook, sheets };
}
