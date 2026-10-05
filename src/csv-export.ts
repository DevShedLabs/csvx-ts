// CSV export, implementing csvx-spec/spec/11-import-export.md 11.2. The output is the sheet's data
// and nothing else, byte for byte predictable: UTF-8, LF terminators, minimal quoting, and no
// escaping or altering of field text. Mirrors csvx-go's csv_export.go.

import { HEADER_ROW, coordinateFor, indicesForCoordinate } from "./coordinates.js";
import { formatValue } from "./format.js";
import { resolveCellValue } from "./model.js";
import type { Sheet, Style, Value, Workbook } from "./model.js";
import { recalculateWorkbook } from "./recalculate.js";

export interface CSVExportOptions {
  /** A sheet id or name; the first sheet when absent. */
  sheet?: string;
  /** Write the header row (default true). */
  header?: boolean;
  /** One character other than `"`, CR or LF (default `,`). */
  delimiter?: string;
  /** `values` (default) writes a formula cell's calculated value, `text` its formula. */
  formulas?: "values" | "text";
  /** Write numbers as their number format displays them (default false). */
  display?: boolean;
}

export interface ExportWarning {
  feature: string;
  location: string;
  message: string;
}

export interface CSVExportResult {
  csv: string;
  warnings: ExportWarning[];
}

/** Writes rows as CSV: every record ends with LF, and a field is quoted if and only if it contains
 * the delimiter, a double quote, CR, or LF. The one CSV writer, used for packages and for export
 * (spec 11.1 and 11.2). */
export function formatCSV(rows: string[][], delimiter = ","): string {
  let out = "";
  for (const row of rows) {
    out += row.map((field) => (field.includes(delimiter) || /["\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field)).join(delimiter) + "\n";
  }
  return out;
}

/** A value in its literal form (spec 04-data-types.md): true or false, a number's or string's text
 * as is, an error as # and its code, a blank as the empty string. */
function literalText(value: Value | undefined): string {
  if (!value || value.type === "blank") return "";
  if (value.type === "error") return `#${value.code}`;
  if (value.type === "boolean") return value.value ? "true" : "false";
  return String(value.value ?? "");
}

function displayOrLiteral(value: Value, numberFormat: string | undefined): string {
  if (numberFormat && (value.type === "integer" || value.type === "decimal")) return formatValue(value as never, numberFormat);
  return literalText(value);
}

function findSheet(workbook: Workbook, ref: string | undefined): Sheet {
  if (ref === undefined || ref === "") return workbook.sheets[0] as Sheet;
  const found = workbook.sheets.find((s) => s.id === ref) ?? workbook.sheets.find((s) => s.name === ref);
  if (!found) throw new Error(`No such sheet: ${ref}`);
  return found;
}

function hasExportOnlyMetadata(sheet: Sheet): boolean {
  return (
    Boolean(sheet.print) ||
    Object.keys(sheet.rowHeights ?? {}).length > 0 ||
    sheet.columns.some((column) => column.width !== undefined && column.width !== 0) ||
    Object.values(sheet.cells ?? {}).some((metadata) => Boolean(metadata.style) || Boolean(metadata.validation))
  );
}

/** Writes one sheet of a workbook as CSV text and reports what CSV cannot carry. */
export function exportCSV(workbook: Workbook, options: CSVExportOptions = {}): CSVExportResult {
  const delimiter = options.delimiter ?? ",";
  if ([...delimiter].length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") throw new Error("delimiter must be one character other than a double quote, CR or LF");
  const formulas = options.formulas ?? "values";
  if (formulas !== "values" && formulas !== "text") throw new Error(`formulas must be "values" or "text", got ${JSON.stringify(options.formulas)}`);
  if (workbook.sheets.length === 0) throw new Error("workbook requires at least one sheet");
  const requested = findSheet(workbook, options.sheet);
  // A stale or missing cache must never reach the file: recalculate first.
  const calculated = recalculateWorkbook(workbook);
  const sheet = calculated.sheets.find((s) => s.id === requested.id) as Sheet;
  const styles: Style[] | undefined = calculated.styles;

  let rowCount = sheet.records.length;
  let formulaCells = 0;
  for (const [coordinate, metadata] of Object.entries(sheet.cells ?? {})) {
    if (!metadata.formula) continue;
    formulaCells++;
    const { row } = indicesForCoordinate(coordinate);
    if (row + 1 > rowCount) rowCount = row + 1;
  }

  const rows: string[][] = [];
  if (options.header !== false) rows.push(sheet.columns.map((column) => column.name ?? ""));
  for (let r = 0; r < rowCount; r++) {
    rows.push(
      sheet.columns.map((column, c) => {
        const metadata = sheet.cells?.[coordinateFor(c, r)];
        const raw = sheet.records[r]?.[c] ?? "";
        const numberFormat = options.display && metadata?.style ? styles?.find((s) => s.id === metadata.style)?.numberFormat : undefined;
        if (metadata?.formula && formulas === "text") return metadata.formula;
        if (metadata?.formula) return displayOrLiteral((metadata.cached as Value | undefined) ?? { type: "blank" }, numberFormat ?? undefined);
        if (numberFormat) {
          const shown = displayOrLiteral(resolveCellValue(raw, metadata?.type ?? column.type, numberFormat), numberFormat);
          return shown === "" ? raw : shown;
        }
        return raw;
      }),
    );
  }

  const warnings: ExportWarning[] = [];
  if (formulaCells > 0 && formulas !== "text") {
    warnings.push({ feature: "formula", location: sheet.name, message: `${formulaCells} formula cell(s) were exported as their calculated values; the formulas were omitted` });
  }
  if (hasExportOnlyMetadata(sheet) || (workbook.namedRanges?.length ?? 0) > 0) {
    warnings.push({ feature: "metadata", location: sheet.name, message: "CSV holds data only; styles, validation rules, widths, heights, print settings and names were not written" });
  }
  void HEADER_ROW;
  return { csv: formatCSV(rows, delimiter), warnings };
}
