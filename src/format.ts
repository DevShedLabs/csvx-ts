// Presentation-only number formatting, per csvx-spec/spec/08-styles.md: "Number formats MUST NOT
// alter the underlying value. A renderer MAY fall back to a readable default when a format is
// unsupported." This implements a documented, honest subset of Excel-style format codes (the real
// fixture in csvx-spec/examples/styled.csvx/styles.json uses "$#,##0.00") and falls back to the
// plain value string for anything outside that subset — exactly the fallback the spec allows,
// rather than guessing at the rest of Excel's much larger format-code grammar.
//
// Supported patterns: "0", "0.00", "#,##0", "#,##0.00", any of those prefixed with a literal
// currency-ish symbol run (e.g. "$#,##0.00", "€#,##0", or Excel's quoted-literal form `"$"#,##0.00`
// — real XLSX-imported data uses the quoted form, confirmed against csvx-spec/examples/example.csvx's
// own styles.json), and "0%"/"0.00%".

import type { CellValue } from "./calculate.js";

const NUMBER_FORMAT_PATTERN = /^([^\d#]*)([#0](?:[#0,]*[#0])?(?:\.[0#]+)?)(%?)$/;

/** Strips Excel's `"literal text"` quoting from a format code, since the quotes themselves are
 * never displayed — e.g. `"$"#,##0.00` means a literal "$" prefix, not a prefix containing quotes. */
function unquoteLiterals(numberFormat: string): string {
  return numberFormat.replace(/"([^"]*)"/g, "$1");
}

function numericValueOf(value: CellValue): number | null {
  if (value.type === "integer" || value.type === "decimal") {
    const number = Number(value.value);
    return Number.isNaN(number) ? null : number;
  }
  return null;
}

function plainString(value: CellValue): string {
  if (value.type === "blank") return "";
  if (value.type === "error") return `#${value.code}${value.message ? `: ${value.message}` : ""}`;
  if (value.type === "boolean") return value.value ? "TRUE" : "FALSE";
  return String(value.value ?? "");
}

/** Renders a CellValue for display using an Excel-style numberFormat code, falling back to the
 * plain value string when the value isn't numeric or the pattern isn't one of the supported
 * shapes. Never mutates or reinterprets `value` — this is display text only. */
export function formatValue(value: CellValue, numberFormat?: string | null): string {
  if (!numberFormat) return plainString(value);
  const number = numericValueOf(value);
  if (number === null) return plainString(value);

  const match = NUMBER_FORMAT_PATTERN.exec(unquoteLiterals(numberFormat));
  if (!match) return plainString(value);
  const prefix = match[1] ?? "";
  const digits = match[2] ?? "";
  const isPercent = match[3] === "%";
  const scaled = isPercent ? number * 100 : number;
  const hasGrouping = digits.includes(",");
  const decimalPlaces = digits.includes(".") ? (digits.split(".")[1] ?? "").length : 0;

  const fixed = Math.abs(scaled).toFixed(decimalPlaces);
  const [integerPart, fractionPart] = fixed.split(".") as [string, string | undefined];
  const groupedInteger = hasGrouping ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integerPart;
  const sign = scaled < 0 ? "-" : "";
  const body = fractionPart ? `${groupedInteger}.${fractionPart}` : groupedInteger;

  return `${sign}${prefix}${body}${isPercent ? "%" : ""}`;
}
