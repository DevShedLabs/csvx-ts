// Text case conversion, per csvx-spec/spec/05-cell-values.md ("Text case"). Per-code-point,
// locale-independent mapping; a code point whose mapping is not exactly one code point is left
// unchanged so every engine agrees. Mirrors csvx-go's text_case.go.

import { literalType } from "./literal.js";
import type { ScalarType } from "./model.js";

export type TextCaseMode = "upper" | "lower" | "title";

export interface ChangeCaseOptions {
  /** The cell's resolved type: its own override, else its column's. Omit when nothing declares one. */
  declaredType?: ScalarType;
  /** True for a header cell (row 1): its text is a column name, so it is always a string and the
   * column's declared type is ignored. */
  header?: boolean;
  /** Present when the cell is a formula cell; formula cells are never changed. */
  formula?: string;
}

function mapCodePoint(char: string, mode: "upper" | "lower"): string {
  const mapped = mode === "upper" ? char.toUpperCase() : char.toLowerCase();
  return [...mapped].length === 1 ? mapped : char;
}

const LETTER = /^\p{L}$/u;
const WORD_CHAR = /^[\p{L}\p{N}\p{M}]$/u;

/** True when a cell's text is eligible for case conversion (spec: no formula, resolves to string). */
export function isCaseEligible(text: string, options: ChangeCaseOptions = {}): boolean {
  if (options.header) return text !== "";
  if (options.formula) return false;
  if (options.declaredType) return options.declaredType === "string" && text !== "";
  return literalType(text) === "string";
}

/** Returns the converted text, or `text` unchanged when the cell is not eligible. */
export function changeCase(text: string, mode: TextCaseMode, options: ChangeCaseOptions = {}): string {
  if (!isCaseEligible(text, options)) return text;
  const chars = [...text];
  if (mode !== "title") return chars.map((char) => mapCodePoint(char, mode)).join("");

  const lowered = chars.map((char) => mapCodePoint(char, "lower"));
  let inWord = false;
  return lowered
    .map((char, index) => {
      const isApostrophe = (char === "'" || char === "’") && LETTER.test(lowered[index - 1] ?? "") && LETTER.test(lowered[index + 1] ?? "");
      if (isApostrophe) return char;
      if (!WORD_CHAR.test(char)) {
        inWord = false;
        return char;
      }
      const out = inWord ? char : mapCodePoint(char, "upper");
      inWord = true;
      return out;
    })
    .join("");
}
