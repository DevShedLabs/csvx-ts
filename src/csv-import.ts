// Plain CSV → CSVX workbook, per csvx-spec/spec/11-import-export.md §11.1. Pure and browser-safe:
// CSV text in, in-memory Workbook out. Mirrors csvx-go's csv_import.go; the conformance vectors in
// csvx-spec/tests/import-csv/ are the shared contract.

import { columnId } from "./columns.js";
import { literalType } from "./literal.js";
import type { LiteralType } from "./literal.js";
import type { Column, Workbook } from "./model.js";

export interface CSVImportOptions {
  /** Single-character field delimiter. Default ",". Never auto-detected. */
  delimiter?: string;
  /** The first record is the header row. Default true. */
  header?: boolean;
  /** Declare column types from the data. Default false. */
  infer?: boolean;
  /** Sheet name. Default "Sheet 1". */
  name?: string;
}

export interface ImportWarning {
  location: string;
  reason: string;
}

export interface CSVImportResult {
  workbook: Workbook;
  warnings: ImportWarning[];
}

/** Malformed CSV; `line` is the 1-based line of the fault. */
export class CSVSyntaxError extends Error {
  constructor(
    readonly line: number,
    reason: string,
  ) {
    super(`malformed CSV at line ${line}: ${reason}`);
    this.name = "CSVSyntaxError";
  }
}

export function importCSV(input: string | Uint8Array, options: CSVImportOptions = {}): CSVImportResult {
  let text: string;
  if (typeof input === "string") {
    text = input;
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input);
    } catch {
      throw new Error("CSV input is not valid UTF-8");
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const name = options.name === undefined || options.name === "" ? "Sheet 1" : options.name;
  validateSheetName(name);
  const delimiter = options.delimiter ?? ",";
  if ([...delimiter].length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new Error(`invalid delimiter ${JSON.stringify(delimiter)}`);
  }
  const hasHeader = options.header !== false;

  let records = parseRecords(text, delimiter);
  if (records.length === 0) throw new Error("CSV input has no records; a sheet needs a header row");

  const warnings: ImportWarning[] = [];
  let header: string[] = [];
  if (hasHeader) {
    header = records[0] as string[];
    records = records.slice(1);
  } else {
    warnings.push({ location: "record 1", reason: "no header row: synthesized a header, so data rows are shifted down by one" });
  }

  const headerWidth = header.length;
  const width = records.reduce((max, record) => Math.max(max, record.length), headerWidth);
  while (header.length < width) header.push("");
  // An empty header field is legal (spec 03-sheets.md): the column simply has the empty name, and the
  // importer invents nothing.

  const firstData = hasHeader ? 2 : 1;
  records = records.map((record, index) => {
    const location = `record ${firstData + index}`;
    if (hasHeader && record.length > headerWidth) {
      warnings.push({ location, reason: `has ${record.length} fields; header has ${headerWidth}, added columns with the empty name` });
    }
    if (record.length < width) {
      warnings.push({ location, reason: `has ${record.length} fields; padded to ${width}` });
      return [...record, ...new Array<string>(width - record.length).fill("")];
    }
    return record;
  });

  const columns: Column[] = header.map((columnName, index) => {
    const column: Column = { id: columnId(index), name: columnName };
    if (options.infer) {
      const type = inferColumnType(records, index);
      if (type) column.type = type;
    }
    return column;
  });

  const id = sheetIdFromName(name);
  const sheet = {
    id,
    name,
    path: `sheets/${id}.csv`,
    ...(columns.some((column) => column.type) ? { metadataPath: `sheets/${id}.meta.json` } : {}),
    columns,
    records,
    cells: {},
  };
  return { workbook: { id, version: "1.0", sheets: [sheet], calculation: { mode: "automatic" } }, warnings };
}

type DeclaredType = NonNullable<Column["type"]>;

/** Spec §11.1 "Type inference" for one column; undefined means no type is declared. */
function inferColumnType(records: string[][], column: number): DeclaredType | undefined {
  const seen = new Set<LiteralType>();
  for (const record of records) {
    const kind = literalType(record[column] as string);
    if (kind !== "blank") seen.add(kind);
  }
  if (seen.size === 0) return undefined;
  if (seen.size === 1) return [...seen][0] as DeclaredType;
  if (seen.size === 2 && seen.has("integer") && seen.has("decimal")) return "decimal";
  return "string";
}

function validateSheetName(name: string): void {
  if ([...name].length > 255) throw new Error("sheet name is longer than 255 characters");
  // eslint-disable-next-line no-control-regex
  if (/[:\u0000-\u001f\u007f-\u009f]/.test(name)) throw new Error("sheet name must not contain ':' or control characters");
}

/** The stable sheet/workbook id derived from a name, per spec §11.1. */
export function sheetIdFromName(name: string): string {
  let id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (id === "") return "sheet-1";
  if (!/^[a-z]/.test(id)) id = `s${id}`;
  return id.slice(0, 64);
}

/** RFC 4180 reader: strict about quoting (reports the 1-based line), skips wholly empty lines,
 * normalizes CRLF inside quoted fields to LF. */
function parseRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let line = 1;
  let index = 0;
  const length = text.length;
  let atFieldStart = true;
  let lineHasContent = false;

  const endRecord = () => {
    if (lineHasContent) {
      record.push(field);
      records.push(record);
    }
    record = [];
    field = "";
    atFieldStart = true;
    lineHasContent = false;
  };

  while (index < length) {
    const char = text[index] as string;
    if (char === '"' && atFieldStart) {
      const startLine = line;
      lineHasContent = true;
      atFieldStart = false;
      index++;
      for (;;) {
        if (index >= length) throw new CSVSyntaxError(startLine, "extraneous or missing \" in quoted-field");
        const inner = text[index] as string;
        if (inner === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 2;
            continue;
          }
          index++;
          break;
        }
        if (inner === "\r" && text[index + 1] === "\n") {
          field += "\n";
          line++;
          index += 2;
          continue;
        }
        if (inner === "\n") line++;
        field += inner;
        index++;
      }
      const next = text[index];
      if (next !== undefined && next !== delimiter && next !== "\n" && !(next === "\r" && text[index + 1] === "\n")) {
        throw new CSVSyntaxError(line, "extraneous or missing \" in quoted-field");
      }
      continue;
    }
    if (char === delimiter) {
      record.push(field);
      field = "";
      atFieldStart = true;
      lineHasContent = true;
      index++;
      continue;
    }
    if (char === "\n" || (char === "\r" && text[index + 1] === "\n")) {
      endRecord();
      line++;
      index += char === "\n" ? 1 : 2;
      continue;
    }
    if (char === '"') throw new CSVSyntaxError(line, 'bare " in non-quoted field');
    field += char;
    atFieldStart = false;
    lineHasContent = true;
    index++;
  }
  endRecord();
  return records;
}
