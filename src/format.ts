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

interface ParsedNumberFormat {
  prefix: string;
  hasGrouping: boolean;
  decimalPlaces: number;
  isPercent: boolean;
}

/** Parses a numberFormat code into the shape both formatValue (forward: value -> display text) and
 * parseFormattedLiteral (reverse: typed text -> value) need. Returns null for anything outside the
 * documented supported subset — see formatValue's comment. */
function parseNumberFormatCode(numberFormat: string): ParsedNumberFormat | null {
  const match = NUMBER_FORMAT_PATTERN.exec(unquoteLiterals(numberFormat));
  if (!match) return null;
  const prefix = match[1] ?? "";
  const digits = match[2] ?? "";
  return {
    prefix,
    hasGrouping: digits.includes(","),
    decimalPlaces: digits.includes(".") ? (digits.split(".")[1] ?? "").length : 0,
    isPercent: match[3] === "%",
  };
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

  const parsed = parseNumberFormatCode(numberFormat);
  if (!parsed) return plainString(value);
  const scaled = parsed.isPercent ? number * 100 : number;

  const fixed = Math.abs(scaled).toFixed(parsed.decimalPlaces);
  const [integerPart, fractionPart] = fixed.split(".") as [string, string | undefined];
  const groupedInteger = parsed.hasGrouping ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : integerPart;
  const sign = scaled < 0 ? "-" : "";
  const body = fractionPart ? `${groupedInteger}.${fractionPart}` : groupedInteger;

  return `${sign}${parsed.prefix}${body}${parsed.isPercent ? "%" : ""}`;
}

/** The inverse of formatValue: attempts to parse typed literal text back into a numeric CellValue
 * using a cell's own numberFormat, per spec/08-styles.md's symmetric MAY — e.g. "$7.00" against
 * `"$"#,##0.00` becomes decimal "7.00" instead of falling through to string just because it has a
 * currency symbol. Scoped strictly to the same documented format subset formatValue supports; this
 * is not general multi-locale currency parsing (see that file's comment for why). Returns null
 * (never a value) for text that doesn't match the format's own affix/grouping shape, or when there
 * is no numberFormat at all — the caller falls through to its own generic literal rules either way. */
export function parseFormattedLiteral(text: string, numberFormat?: string | null): CellValue | null {
  if (!numberFormat) return null;
  const parsed = parseNumberFormatCode(numberFormat);
  if (!parsed) return null;

  let body = text.trim();
  if (parsed.prefix) {
    if (!body.startsWith(parsed.prefix)) return null;
    body = body.slice(parsed.prefix.length);
  }
  let isPercentLiteral = false;
  if (parsed.isPercent) {
    if (!body.endsWith("%")) return null;
    body = body.slice(0, -1);
    isPercentLiteral = true;
  }
  if (parsed.hasGrouping) body = body.replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(body)) return null;

  if (isPercentLiteral) return { type: "decimal", value: String(Number(body) / 100) };
  if (!body.includes(".")) return { type: "integer", value: Number(body) };
  return { type: "decimal", value: body };
}
