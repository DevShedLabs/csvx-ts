// The canonical in-memory CSVX model. Every shape that schemas/*.json already describes is
// derived from the generated model in ./schema/generated.ts (see csvx-spec/AGENTS.md rule 3.1) —
// nothing here is re-typed from memory of what the shape "should" be. Types that don't correspond
// 1:1 to a schema (Sheet, Workbook, WorkbookDocument) combine generated pieces with the runtime
// shape this engine actually works with (e.g. CSV records as string[][], not the JSON schema,
// since CSV has no JSON Schema of its own).

import type {
  CSVXManifest,
  CSVXSheetMetadata,
  CSVXStyles,
  CSVXWorkbook,
  Cell,
  Column,
  Validation,
  Value,
} from "./schema/generated.js";
import { parseFormattedLiteral } from "./format.js";

export type Manifest = CSVXManifest;
export type { Column, Validation, Value };
export type CellMetadata = Cell;

/** A single style record — the element type of CSVXStyles.styles, not re-declared by hand. */
export type Style = CSVXStyles["styles"][number];

/** A sheet's locator entry as it appears in workbook.json. */
export type SheetEntry = CSVXWorkbook["sheets"][number];

export type ScalarType = Value["type"];

/** Resolves a sheet CSV cell's raw text to a typed Value, per spec/03-sheets.md: "Column types
 * provide defaults and validation hints; an individual cell MAY override a column type." This is
 * the one place that decision gets made — consumer apps (csvx-web) must call this rather than
 * sniffing "looks like a number" themselves (csvx-spec/AGENTS.md rule 1). `declaredType` is the
 * resolved cell/column type (a cell's own `type` override wins over its column's).
 *
 * When nothing declares a type at all (no column type, no per-cell override — true for any
 * hand-authored or freshly-edited CSVX, as opposed to an exhaustively cell-annotated XLSX import),
 * there's still no spec text saying a plain CSV cell containing "2" is a string forever just
 * because nobody wrote `"type":"integer"` next to it. Every CSV-consuming spreadsheet tool infers
 * a basic literal type in that case, so this falls back to the same narrow, well-established
 * inference (blank/boolean/integer/decimal by literal shape, otherwise string) rather than
 * defaulting everything untyped to "string" and silently breaking formula arithmetic over it. A
 * declared type (including an explicit "string") always wins and is never second-guessed.
 *
 * `numberFormat` (the cell's resolved style numberFormat, if any) is tried first, per
 * spec/08-styles.md's symmetric parsing allowance — "$7.00" against a `"$"#,##0.00` numberFormat
 * resolves to decimal "7.00" rather than falling through to string just because it looks like
 * currency text. See format.ts's parseFormattedLiteral for the documented, bounded subset this
 * covers; anything outside it falls through to the plain literal-shape inference below. */
export function resolveCellValue(raw: string | undefined, declaredType?: ScalarType, numberFormat?: string | null): Value {
  const text = raw ?? "";
  if (text === "") return { type: "blank" };
  if (declaredType) {
    switch (declaredType) {
      case "blank":
        return { type: "blank" };
      case "boolean":
        return { type: "boolean", value: /^true$/i.test(text.trim()) };
      case "integer": {
        const number = Number(text);
        return Number.isInteger(number) ? { type: "integer", value: number } : { type: "error", code: "VALUE" };
      }
      case "decimal":
        return Number.isNaN(Number(text)) ? { type: "error", code: "VALUE" } : { type: "decimal", value: text };
      case "date":
      case "time":
      case "datetime":
        return { type: declaredType, value: text };
      case "error":
        return { type: "error", code: text || "VALUE" };
      default:
        return { type: "string", value: text };
    }
  }
  const formatted = parseFormattedLiteral(text, numberFormat);
  if (formatted) return formatted as Value;
  const trimmed = text.trim();
  if (/^(?:true|false)$/i.test(trimmed)) return { type: "boolean", value: /^true$/i.test(trimmed) };
  if (/^[+-]?\d+$/.test(trimmed)) return { type: "integer", value: Number(trimmed) };
  if (/^[+-]?\d+\.\d+$/.test(trimmed)) return { type: "decimal", value: trimmed };
  return { type: "string", value: text };
}

/** Computes the next cell metadata object after an edit overwrites a cell's content, per
 * spec/05-cell-values.md: `type`, `formula`, and `cached` describe a cell's *content* and must
 * never survive past what they described, while `style`, `validation`, and any field this engine
 * doesn't recognize (preserved per AGENTS.md rule 3.6) describe the cell itself and are untouched.
 * Consumer apps must call this rather than deciding for themselves which fields survive an edit
 * (AGENTS.md rule 5.2 — no second opinion about what a CSVX value/type means). A real bug this
 * fixes: a cell XLSX-imported with an explicit `"type":"blank"` override (common — an import
 * annotates its whole used range per-cell) silently ate any new literal value typed into it in
 * csvx-web, because resolveCellValue(raw, "blank") always returns blank regardless of `raw` — the
 * stale override has to be dropped at edit time, not worked around at read time.
 *
 * Pass `formula` when the new content is a formula (starts with "="); omit it for a literal edit.
 * Returns `undefined` when nothing is left worth keeping (no metadata entry needed at all). */
export function nextCellMetadata(existing: CellMetadata | undefined, formula?: string): CellMetadata | undefined {
  const { formula: _formula, cached: _cached, type: _type, ...preserved } = existing ?? {};
  if (formula) return { ...preserved, formula };
  return Object.keys(preserved).length > 0 ? preserved : undefined;
}

export interface Calculation {
  mode?: "automatic" | "manual" | "on-load";
  iteration?: boolean;
}

/** Feature/warning counts recorded when a workbook was imported from an external format. */
export interface XLSXFeatureCounts {
  [feature: string]: number;
}

export interface XLSXDiagnostic {
  severity: string;
  feature: string;
  message: string;
}

/** Describes an embedded external workbook (e.g. XLSX) preserved for interoperability. */
export interface SourceMetadata {
  format: string;
  filename: string;
  sha256: string;
  authority: string;
  importedAt: string;
  importer: string;
  features?: XLSXFeatureCounts;
  warnings?: XLSXDiagnostic[];
}

/** A CSV-backed worksheet. `records` excludes the CSV header row, same as csvx-go's Sheet. */
export interface Sheet {
  id: string;
  name: string;
  path: string;
  metadataPath?: string;
  columns: Column[];
  records: string[][];
  rowHeights?: Record<number, number>;
  cells?: Record<string, CellMetadata>;
}

/** The canonical in-memory representation of a CSVX workbook. */
export interface Workbook {
  id: string;
  version: string;
  sheets: Sheet[];
  calculation?: Calculation;
  source?: SourceMetadata;
  styles?: Style[];
  sourceBytes?: Uint8Array;
}

/** The serialized workbook.json resource shape. */
export interface WorkbookDocument {
  id: string;
  version: string;
  sheets: SheetEntry[];
  calculation?: Calculation;
  source?: SourceMetadata;
  styles?: string;
}
