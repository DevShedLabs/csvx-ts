// Workbook edit operations, implementing csvx-spec/spec/15-edit-operations.md. Every function is
// pure: it returns a new Workbook and never mutates its input. An invalid operation throws
// InvalidEditError and changes nothing. By default each operation recalculates the workbook
// afterwards (spec/10-calculation.md); pass `{ recalculate: false }` to get the model as the
// operation left it, which is what the conformance vectors compare.
//
// Schema validation is deliberately not done here (csvx-spec/AGENTS.md rule 3.3): validate the
// saved package with the canonical validator instead.

import { columnId, columnIndexFromId } from "./columns.js";
import { parseFormattedLiteral } from "./format.js";
import { nextCellMetadata } from "./model.js";
import type { CellMetadata, Column, Print, Sheet, Style, Workbook } from "./model.js";
import { canonicalCellText, recalculateWorkbook } from "./recalculate.js";
import { rewriteFormulaForAxisEdit, rewriteFormulaForSheetChange, translateFormula } from "./rewrite.js";
import type { AxisEdit } from "./rewrite.js";

export class InvalidEditError extends Error {}

export interface EditOptions {
  /** Recalculate after the edit (default true). */
  recalculate?: boolean;
}

/** After a supported edit the embedded XLSX source no longer describes the workbook, so its
 * authority becomes `csvx` (spec/14-xlsx-interoperability.md, 14.2). */
function markEdited(workbook: Workbook): Workbook {
  if (workbook.source?.authority !== "original") return workbook;
  return { ...workbook, source: { ...workbook.source, authority: "csvx" } };
}

function finish(workbook: Workbook, options?: EditOptions): Workbook {
  const edited = markEdited(workbook);
  return options?.recalculate === false ? edited : recalculateWorkbook(edited);
}

function sheetIndex(workbook: Workbook, ref: string): number {
  let index = workbook.sheets.findIndex((sheet) => sheet.id === ref);
  if (index < 0) index = workbook.sheets.findIndex((sheet) => sheet.name === ref);
  if (index < 0) throw new InvalidEditError(`No such sheet: ${ref}`);
  return index;
}

function replaceSheet(workbook: Workbook, index: number, sheet: Sheet): Workbook {
  return { ...workbook, sheets: workbook.sheets.map((item, i) => (i === index ? sheet : item)) };
}

const COORDINATE = /^([A-Z]+)([1-9]\d*)$/;

function parseCoordinate(coordinate: string): { column: number; rowNumber: number } {
  const match = COORDINATE.exec(coordinate);
  if (!match) throw new InvalidEditError(`Invalid coordinate: ${coordinate}`);
  return { column: columnIndexFromId(match[1] as string), rowNumber: Number(match[2]) };
}

/** Rewrites every formula a cell's metadata carries: its own `formula`, and a validation rule's
 * `formula1`/`formula2` when they begin with `=` (spec/15, "Reference rewriting"). */
function rewriteCellFormulas(metadata: CellMetadata, rewrite: (formula: string) => string): CellMetadata {
  let next = metadata;
  if (next.formula) next = { ...next, formula: rewrite(next.formula) };
  const validation = next.validation as Record<string, unknown> | undefined;
  if (validation && typeof validation === "object") {
    let changed: Record<string, unknown> | undefined;
    for (const key of ["formula1", "formula2"]) {
      const value = validation[key];
      if (typeof value === "string" && value.startsWith("=")) changed = { ...(changed ?? validation), [key]: rewrite(value) };
    }
    if (changed) next = { ...next, validation: changed as CellMetadata["validation"] };
  }
  return next;
}

/** A name's `refersTo` has no home sheet: every reference in it is sheet-qualified. */
const NO_HOME_SHEET = "\u0000";

function rewriteNamedRanges(workbook: Workbook, rewrite: (formula: string) => string): Workbook {
  if (!workbook.namedRanges) return workbook;
  return { ...workbook, namedRanges: workbook.namedRanges.map((item) => ({ ...item, refersTo: rewrite(item.refersTo) })) };
}

// ---------------------------------------------------------------------------------------------
// Structural edits: insert/delete rows and columns.

function assertCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) throw new InvalidEditError("count must be an integer of at least 1");
}

/** Applies one axis edit to the whole workbook: rewrites every formula on every sheet, then, for the
 * target sheet only, moves cell metadata and row heights and applies `reshape` to its grid. */
function applyAxisEdit(workbook: Workbook, target: number, edit: AxisEdit, reshape: (sheet: Sheet) => Sheet): Workbook {
  const targetSheet = workbook.sheets[target] as Sheet;
  const sheets = workbook.sheets.map((sheet, index) => {
    const rewritten: Record<string, CellMetadata> = {};
    for (const [coordinate, metadata] of Object.entries(sheet.cells ?? {})) {
      const next = rewriteCellFormulas(metadata, (formula) => rewriteFormulaForAxisEdit(formula, sheet.name, targetSheet.name, edit));
      if (index !== target) {
        rewritten[coordinate] = next;
        continue;
      }
      const { column, rowNumber } = parseCoordinate(coordinate);
      const moved = edit.axis === "row" ? edit.map(rowNumber) : edit.map(column);
      const deleted = edit.deleted.has(edit.axis === "row" ? rowNumber : column);
      if (deleted) continue;
      rewritten[edit.axis === "row" ? `${columnId(column)}${moved}` : `${columnId(moved)}${rowNumber}`] = next;
    }
    if (index !== target) return sheet.cells ? { ...sheet, cells: rewritten } : sheet;
    let next: Sheet = { ...sheet, cells: rewritten };
    if (edit.axis === "row" && sheet.rowHeights) {
      const heights: Record<number, number> = {};
      for (const [rowNumber, height] of Object.entries(sheet.rowHeights)) {
        const row = Number(rowNumber);
        if (!edit.deleted.has(row)) heights[edit.map(row)] = height;
      }
      next = { ...next, rowHeights: heights };
    }
    if (sheet.print) next = rewritePrint(next, targetSheet.name, edit);
    return reshape(next);
  });
  return rewriteNamedRanges({ ...workbook, sheets }, (formula) => rewriteFormulaForAxisEdit(formula, NO_HOME_SHEET, targetSheet.name, edit));
}

function rewritePrint(sheet: Sheet, name: string, edit: AxisEdit): Sheet {
  if (!sheet.print) return sheet;
  const print: Print = { ...sheet.print };
  const rewriteRange = (text: string): string | undefined => {
    const out = rewriteFormulaForAxisEdit(`=${text}`, name, name, edit);
    return out.includes("#REF!") ? undefined : out.slice(1);
  };
  if (typeof print.area === "string") {
    const next = rewriteRange(print.area);
    if (next === undefined) delete print.area;
    else print.area = next;
  }
  if (edit.axis === "row" && typeof print.repeatRows === "string") {
    const match = /^(\d+):(\d+)$/.exec(print.repeatRows);
    const next = match && rewriteRange(`A${match[1]}:A${match[2]}`);
    if (match && next === undefined) delete print.repeatRows;
    else if (match && next) print.repeatRows = next.replace(/^A(\d+):A(\d+)$/, "$1:$2");
  }
  if (edit.axis === "column" && typeof print.repeatColumns === "string") {
    const match = /^([A-Z]+):([A-Z]+)$/.exec(print.repeatColumns);
    const next = match && rewriteRange(`${match[1]}1:${match[2]}1`);
    if (match && next === undefined) delete print.repeatColumns;
    else if (match && next) print.repeatColumns = next.replace(/^([A-Z]+)1:([A-Z]+)1$/, "$1:$2");
  }
  const breaksKey = edit.axis === "row" ? "rowBreaks" : "columnBreaks";
  const breaks = print[breaksKey];
  if (Array.isArray(breaks)) {
    const offset = edit.axis === "row" ? 0 : 1; // column breaks are 1-based; the edit works 0-based
    print[breaksKey] = (breaks as number[]).filter((n) => !edit.deleted.has(n - offset)).map((n) => edit.map(n - offset) + offset);
  }
  return { ...sheet, print };
}

/** Inserts `count` blank rows before row number `at` (A1 row number, at least 2). */
export function insertRows(workbook: Workbook, sheet: string, at: number, count = 1, options?: EditOptions): Workbook {
  assertCount(count);
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  if (!Number.isInteger(at) || at < 2 || at > current.records.length + 2) throw new InvalidEditError(`Cannot insert before row ${at}`);
  const edit: AxisEdit = { axis: "row", map: (row) => (row >= at ? row + count : row), deleted: new Set() };
  const next = applyAxisEdit(workbook, target, edit, (s) => ({
    ...s,
    records: [...s.records.slice(0, at - 2), ...Array.from({ length: count }, () => Array<string>(s.columns.length).fill("")), ...s.records.slice(at - 2)],
  }));
  return finish(next, options);
}

/** Deletes the given rows (A1 row numbers, each at least 2) in one pass. */
export function deleteRows(workbook: Workbook, sheet: string, rows: number[], options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  const doomed = new Set(rows);
  for (const row of doomed) {
    if (!Number.isInteger(row) || row < 2 || row > current.records.length + 1) throw new InvalidEditError(`Cannot delete row ${row}`);
  }
  const sorted = [...doomed].sort((a, b) => a - b);
  const edit: AxisEdit = { axis: "row", map: (row) => row - sorted.filter((d) => d < row).length, deleted: doomed };
  const next = applyAxisEdit(workbook, target, edit, (s) => ({ ...s, records: s.records.filter((_, i) => !doomed.has(i + 2)) }));
  return finish(next, options);
}

function columnIndexArg(letter: string): number {
  if (!/^[A-Z]+$/.test(letter)) throw new InvalidEditError(`Invalid column: ${letter}`);
  return columnIndexFromId(letter);
}

function renumberColumns(columns: Column[]): Column[] {
  return columns.map((column, index) => ({ ...column, id: columnId(index) }));
}

/** Inserts `count` blank columns before the column with letter `at`. The new columns have the empty
 * name (spec/03-sheets.md, spec/15). */
export function insertColumns(workbook: Workbook, sheet: string, at: string, count = 1, options?: EditOptions): Workbook {
  assertCount(count);
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  const index = columnIndexArg(at);
  if (index > current.columns.length) throw new InvalidEditError(`Cannot insert before column ${at}`);
  const edit: AxisEdit = { axis: "column", map: (column) => (column >= index ? column + count : column), deleted: new Set() };
  const next = applyAxisEdit(workbook, target, edit, (s) => ({
    ...s,
    columns: renumberColumns([
      ...s.columns.slice(0, index),
      ...Array.from({ length: count }, () => ({ id: "", name: "" }) as Column),
      ...s.columns.slice(index),
    ]),
    records: s.records.map((row) => [...row.slice(0, index), ...Array<string>(count).fill(""), ...row.slice(index)]),
  }));
  return finish(next, options);
}

/** Deletes the columns with the given letters in one pass; a sheet keeps at least one column. */
export function deleteColumns(workbook: Workbook, sheet: string, columns: string[], options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  const doomed = new Set(columns.map(columnIndexArg));
  for (const index of doomed) if (index >= current.columns.length) throw new InvalidEditError(`Cannot delete column ${columnId(index)}`);
  if (doomed.size >= current.columns.length) throw new InvalidEditError("A sheet must keep at least one column");
  const sorted = [...doomed].sort((a, b) => a - b);
  const edit: AxisEdit = { axis: "column", map: (column) => column - sorted.filter((d) => d < column).length, deleted: doomed };
  const keep = (_: unknown, i: number) => !doomed.has(i);
  const next = applyAxisEdit(workbook, target, edit, (s) => ({ ...s, columns: renumberColumns(s.columns.filter(keep)), records: s.records.map((row) => row.filter(keep)) }));
  return finish(next, options);
}

// ---------------------------------------------------------------------------------------------
// Sheets.

/** Appends an empty sheet: one column with the empty name and no data rows. */
export function addSheet(workbook: Workbook, options?: EditOptions): Workbook {
  const ids = new Set(workbook.sheets.map((sheet) => sheet.id));
  const names = new Set(workbook.sheets.map((sheet) => sheet.name));
  let n = workbook.sheets.length + 1;
  while (ids.has(`sheet-${n}`) || names.has(`Sheet ${n}`)) n++;
  const id = `sheet-${n}`;
  const sheet: Sheet = { id, name: `Sheet ${n}`, path: `sheets/${id}.csv`, columns: [{ id: "A", name: "" } as Column], records: [], cells: {} };
  return finish({ ...workbook, sheets: [...workbook.sheets, sheet] }, options);
}

function rewriteAllFormulas(workbook: Workbook, rewrite: (formula: string) => string): Workbook {
  const sheets = workbook.sheets.map((sheet) => {
    if (!sheet.cells) return sheet;
    const cells: Record<string, CellMetadata> = {};
    for (const [coordinate, metadata] of Object.entries(sheet.cells)) cells[coordinate] = rewriteCellFormulas(metadata, rewrite);
    return { ...sheet, cells };
  });
  return rewriteNamedRanges({ ...workbook, sheets }, rewrite);
}

/** Renames a sheet and rewrites every sheet-qualified reference to it. */
export function renameSheet(workbook: Workbook, sheet: string, name: string, options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  if (name === "" || [...name].length > 255 || /[:\u0000-\u001f\u007f]/.test(name)) throw new InvalidEditError(`Invalid sheet name: ${JSON.stringify(name)}`);
  if (workbook.sheets.some((item, i) => i !== target && item.name === name)) throw new InvalidEditError(`Sheet name already in use: ${name}`);
  const renamed = replaceSheet(workbook, target, { ...current, name });
  return finish(rewriteAllFormulas(renamed, (formula) => rewriteFormulaForSheetChange(formula, current.name, name)), options);
}

/** Deletes a sheet; references to it become `#REF!`. A workbook keeps at least one sheet. */
export function deleteSheet(workbook: Workbook, sheet: string, options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  if (workbook.sheets.length <= 1) throw new InvalidEditError("A workbook must keep at least one sheet");
  const removed = workbook.sheets[target] as Sheet;
  const remaining = { ...workbook, sheets: workbook.sheets.filter((_, i) => i !== target) };
  return finish(rewriteAllFormulas(remaining, (formula) => rewriteFormulaForSheetChange(formula, removed.name, undefined)), options);
}

// ---------------------------------------------------------------------------------------------
// Cells.

/** Works on a private copy of a sheet so a multi-cell edit (paste) copies its grid once. */
function cloneSheet(sheet: Sheet): Sheet {
  return { ...sheet, columns: [...sheet.columns], records: sheet.records.map((row) => [...row]), cells: { ...sheet.cells } };
}

function extendSheet(sheet: Sheet, rowNumber: number, column: number): void {
  while (sheet.columns.length <= column) {
    const index = sheet.columns.length;
    sheet.columns.push({ id: columnId(index), name: "" } as Column);
    for (const row of sheet.records) row.push("");
  }
  while (sheet.records.length < rowNumber - 1) sheet.records.push(Array<string>(sheet.columns.length).fill(""));
}

function setCellOn(sheet: Sheet, styles: Style[] | undefined, coordinate: string, text: string): void {
  const { column, rowNumber } = parseCoordinate(coordinate);
  extendSheet(sheet, rowNumber, column);
  const isFormula = text.startsWith("=");
  const metadata = nextCellMetadata(sheet.cells?.[coordinate], isFormula ? text : undefined);
  const cells = sheet.cells as Record<string, CellMetadata>;
  if (metadata) cells[coordinate] = metadata;
  else delete cells[coordinate];
  if (rowNumber === 1) {
    sheet.columns[column] = { ...(sheet.columns[column] as Column), name: text };
    return;
  }
  const record = sheet.records[rowNumber - 2] as string[];
  if (isFormula) {
    record[column] = "";
    return;
  }
  const declaredType = sheet.columns[column]?.type;
  const numberFormat = metadata?.style ? styles?.find((style) => style.id === metadata.style)?.numberFormat : undefined;
  const formatted = !declaredType ? parseFormattedLiteral(text, numberFormat) : null;
  record[column] = formatted && (formatted.type === "integer" || formatted.type === "decimal") ? canonicalCellText(formatted) : text;
}

/** Replaces a cell's content with what the user typed (a formula if it starts with `=`). */
export function setCell(workbook: Workbook, sheet: string, coordinate: string, text: string, options?: EditOptions): Workbook {
  return paste(workbook, sheet, coordinate, [[text]], options);
}

/** Applies a rectangle of texts, top-left at `anchor`, as one setCell each. Atomic: if any element
 * is invalid, nothing is applied. Formula text is stored verbatim unless `options.from` (the
 * coordinate the rows were copied from) is given, in which case it is translated (spec/15). */
export function paste(workbook: Workbook, sheet: string, anchor: string, rows: string[][], options?: EditOptions & { from?: string }): Workbook {
  const target = sheetIndex(workbook, sheet);
  const start = parseCoordinate(anchor);
  const origin = options?.from === undefined ? undefined : parseCoordinate(options.from);
  const copy = cloneSheet(workbook.sheets[target] as Sheet);
  rows.forEach((row, r) =>
    row.forEach((text, c) => {
      const translated = origin && text.startsWith("=") ? translateFormula(text, start.rowNumber - origin.rowNumber, start.column - origin.column) : text;
      setCellOn(copy, workbook.styles, `${columnId(start.column + c)}${start.rowNumber + r}`, translated);
    }),
  );
  return finish(replaceSheet(workbook, target, copy), options);
}

// ---------------------------------------------------------------------------------------------
// Styles.

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function withoutNulls(group: Json): Json {
  return Object.fromEntries(Object.entries(group).filter(([, value]) => value !== null));
}

function mergeStyle(base: Json, patch: Json): Json {
  const merged: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete merged[key];
    else if (key !== "numberFormat" && isObject(value)) merged[key] = withoutNulls({ ...(isObject(base[key]) ? (base[key] as Json) : {}), ...value });
    else merged[key] = value;
  }
  for (const [key, value] of Object.entries(merged)) if (isObject(value) && Object.keys(value).length === 0) delete merged[key];
  return merged;
}

/** Merges `patch` into each listed cell's style, reusing an identical existing style or adding one
 * (`s<N>`). Existing styles are never modified. */
export function applyStyle(workbook: Workbook, sheet: string, coordinates: string[], patch: Record<string, unknown>, options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  const styles: Style[] = [...(workbook.styles ?? [])];
  const cells: Record<string, CellMetadata> = { ...current.cells };
  let nextId = Math.max(-1, ...styles.map((style) => /^s(\d+)$/.exec(style.id)?.[1]).filter((n) => n !== undefined).map(Number)) + 1;
  const bySignature = new Map<string, string>();
  const signature = (style: Json) => {
    const { id: _id, ...rest } = style;
    return canonical(rest);
  };
  for (const style of styles) if (!bySignature.has(signature(style as Json))) bySignature.set(signature(style as Json), style.id);
  for (const coordinate of coordinates) {
    parseCoordinate(coordinate);
    const existing = cells[coordinate];
    const base = (styles.find((style) => style.id === existing?.style) ?? {}) as Json;
    const { id: _id, ...baseProps } = base;
    const merged = mergeStyle(baseProps, patch);
    if (Object.keys(merged).length === 0) {
      if (existing) {
        const { style: _style, ...rest } = existing;
        if (Object.keys(rest).length > 0) cells[coordinate] = rest;
        else delete cells[coordinate];
      }
      continue;
    }
    let id = bySignature.get(canonical(merged));
    if (!id) {
      id = `s${nextId++}`;
      styles.push({ id, ...merged } as Style);
      bySignature.set(canonical(merged), id);
    }
    cells[coordinate] = { ...existing, style: id };
  }
  return finish({ ...replaceSheet(workbook, target, { ...current, cells }), styles }, options);
}

/** Removes the style reference from each listed cell; `styles.json` is untouched. */
export function clearStyle(workbook: Workbook, sheet: string, coordinates: string[], options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const current = workbook.sheets[target] as Sheet;
  const cells: Record<string, CellMetadata> = { ...current.cells };
  for (const coordinate of coordinates) {
    parseCoordinate(coordinate);
    if (!cells[coordinate]) continue;
    const { style: _style, ...rest } = cells[coordinate] as CellMetadata;
    if (Object.keys(rest).length > 0) cells[coordinate] = rest;
    else delete cells[coordinate];
  }
  return finish(replaceSheet(workbook, target, { ...current, cells }), options);
}

// ---------------------------------------------------------------------------------------------
// Print settings.

/** Merges `patch` into the sheet's print settings: a key set to null is removed, unmentioned and
 * unknown keys are kept, and an emptied object is removed. */
export function setPrint(workbook: Workbook, sheet: string, patch: Record<string, unknown>, options?: EditOptions): Workbook {
  const target = sheetIndex(workbook, sheet);
  const { print: existing, ...rest } = workbook.sheets[target] as Sheet;
  const print: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete print[key];
    else print[key] = value;
  }
  const next = Object.keys(print).length > 0 ? ({ ...rest, print: print as Print } as Sheet) : (rest as Sheet);
  return finish(replaceSheet(workbook, target, next), options);
}
