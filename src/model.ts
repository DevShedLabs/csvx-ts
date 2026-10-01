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
 * declared type (including an explicit "string") always wins and is never second-guessed. */
export function resolveCellValue(raw: string | undefined, declaredType?: ScalarType): Value {
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
  const trimmed = text.trim();
  if (/^(?:true|false)$/i.test(trimmed)) return { type: "boolean", value: /^true$/i.test(trimmed) };
  if (/^[+-]?\d+$/.test(trimmed)) return { type: "integer", value: Number(trimmed) };
  if (/^[+-]?\d+\.\d+$/.test(trimmed)) return { type: "decimal", value: trimmed };
  return { type: "string", value: text };
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
