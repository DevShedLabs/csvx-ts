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
