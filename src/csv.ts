import { formatCSV } from "./csv-export.js";

// A minimal RFC 4180 CSV reader/writer. CSV is the canonical sheet data layer (see README), so
// parsing it is core engine logic, not something a consumer app should ever need to reimplement —
// this is the one place it lives, mirroring csvx-go's csv.go.

export interface ParsedCSV {
  header: string[];
  records: string[][];
}

export function parseCSV(text: string): ParsedCSV {
  const rows = parseCSVRows(text);
  const header = rows[0];
  if (!header || header.length === 0) {
    throw new Error("CSV must contain a header row");
  }
  const records = rows.slice(1);
  records.forEach((record, row) => {
    if (record.length !== header.length) {
      throw new Error(`CSV row ${row + 2} has ${record.length} fields; expected ${header.length}`);
    }
  });
  return { header, records };
}

function parseCSVRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;
  const length = text.length;

  while (index < length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index++;
        continue;
      }
      field += char;
      index++;
      continue;
    }
    switch (char) {
      case '"':
        inQuotes = true;
        index++;
        break;
      case ",":
        row.push(field);
        field = "";
        index++;
        break;
      case "\r":
        index++;
        break;
      case "\n":
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        index++;
        break;
      default:
        field += char;
        index++;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Serializes a header and records back to RFC 4180 CSV text, using `\n` line endings to match
 * csvx-go's output (Go's encoding/csv defaults to `\n`, not `\r\n`) and existing examples/*.csv. */
export function stringifyCSV(header: string[], records: string[][]): string {
  return formatCSV([header, ...records]);
}
