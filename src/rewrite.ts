// Formula reference rewriting for structural edits (csvx-spec/spec/15-edit-operations.md,
// "Reference rewriting"). Rewrites work on the formula's source text, replacing only the reference
// spans, so everything else — spelling, case, spacing, `$` markers, string literals — is preserved.
// A formula that does not parse is returned unchanged: there is nothing meaningful to rewrite.

import { columnId, columnIndexFromId } from "./columns.js";
import { FormulaParseError, parseFormula } from "./formula.js";

/** One axis of a structural edit. Rows are numbered 1-based (A1 row numbers, header = 1) and
 * columns 0-based; the mapping functions work in whichever convention the caller's axis uses. */
export interface AxisEdit {
  axis: "row" | "column";
  /** The new index for an index that survives the edit. */
  map: (index: number) => number;
  /** Indices removed by the edit; empty for an insert. */
  deleted: ReadonlySet<number>;
}

const PLAIN_SHEET_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CELL_LIKE = /^\$?[A-Za-z]+\$?\d+$/;

/** Formats a sheet name for use before `!`, quoting it when it is not a bare identifier. */
export function formatSheetName(name: string): string {
  const bare = PLAIN_SHEET_NAME.test(name) && !CELL_LIKE.test(name) && !/^(true|false)$/i.test(name);
  return bare ? name : `'${name.replace(/'/g, "''")}'`;
}

interface RefSpan {
  start: number;
  end: number;
  /** Where the sheet qualifier (including `!`) begins; equals `start` when absent. */
  sheetStart: number;
  sheet?: string;
  colAbs: string;
  col: string;
  rowAbs: string;
  row: string;
}

const CELL_AT = /^(\$?)([A-Za-z]+)(\$?)(\d+)(?![A-Za-z0-9_$.(])/;
const BARE_SHEET_AT = /^([A-Za-z_][A-Za-z0-9_]*)!/;

/** Finds every cell reference in the formula text, in order, skipping string literals. */
function scanReferences(source: string): RefSpan[] {
  const spans: RefSpan[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === '"') {
      i++;
      while (i < source.length) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (source.slice(i, i + 5).toUpperCase() === "#REF!") {
      i += 5;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      while (i < source.length && /[0-9.]/.test(source[i] as string)) i++;
      continue;
    }
    const sheetStart = i;
    let sheet: string | undefined;
    let cursor = i;
    if (ch === "'") {
      let j = i + 1;
      let name = "";
      while (j < source.length) {
        if (source[j] === "'") {
          if (source[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          break;
        }
        name += source[j];
        j++;
      }
      if (source[j] === "'" && source[j + 1] === "!") {
        sheet = name;
        cursor = j + 2;
      } else {
        i = j + 1;
        continue;
      }
    } else {
      const bare = BARE_SHEET_AT.exec(source.slice(i));
      if (bare) {
        sheet = bare[1] as string;
        cursor = i + bare[0].length;
      }
    }
    const cell = CELL_AT.exec(source.slice(cursor));
    if (cell) {
      spans.push({ start: cursor, end: cursor + cell[0].length, sheetStart, sheet, colAbs: cell[1] as string, col: cell[2] as string, rowAbs: cell[3] as string, row: cell[4] as string });
      i = cursor + cell[0].length;
      continue;
    }
    if (sheet !== undefined) {
      i = cursor;
      continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {
      while (i < source.length && /[A-Za-z0-9_$.]/.test(source[i] as string)) i++;
      continue;
    }
    i++;
  }
  return spans;
}

interface Segment {
  a: RefSpan;
  b?: RefSpan;
}

/** Groups adjacent `ref:ref` spans into ranges. */
function segments(source: string, spans: RefSpan[]): Segment[] {
  const result: Segment[] = [];
  for (let k = 0; k < spans.length; k++) {
    const a = spans[k] as RefSpan;
    const b = spans[k + 1];
    if (b && source.slice(a.end, b.sheetStart) === ":") {
      result.push({ a, b });
      k++;
    } else {
      result.push({ a });
    }
  }
  return result;
}

function spanText(span: RefSpan, index: number, axis: "row" | "column"): string {
  const col = axis === "column" ? columnId(index) : span.col;
  const row = axis === "row" ? String(index) : span.row;
  return `${span.colAbs}${col}${span.rowAbs}${row}`;
}

function indexOf(span: RefSpan, axis: "row" | "column"): number {
  return axis === "row" ? Number(span.row) : columnIndexFromId(span.col);
}

/** Replaces `[start, end)` edits into the source, applied right to left so offsets stay valid. */
function applyReplacements(source: string, replacements: Array<{ start: number; end: number; text: string }>): string {
  let out = source;
  for (const r of [...replacements].sort((x, y) => y.start - x.start)) out = out.slice(0, r.start) + r.text + out.slice(r.end);
  return out;
}

function parses(formula: string): boolean {
  try {
    parseFormula(formula);
    return true;
  } catch (error) {
    if (error instanceof FormulaParseError) return false;
    throw error;
  }
}

/** Rewrites a formula for a row or column insert/delete on `targetSheet`. `ownSheet` is the name of
 * the sheet the formula lives on, which is what its unqualified references target. */
export function rewriteFormulaForAxisEdit(formula: string, ownSheet: string, targetSheet: string, edit: AxisEdit): string {
  if (!parses(formula)) return formula;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const segment of segments(formula, scanReferences(formula))) {
    const { a, b } = segment;
    const targets = (a.sheet ?? b?.sheet ?? ownSheet) === targetSheet;
    if (!targets) continue;
    if (!b) {
      const index = indexOf(a, edit.axis);
      if (edit.deleted.has(index)) {
        replacements.push({ start: a.sheetStart, end: a.end, text: "#REF!" });
      } else {
        const next = edit.map(index);
        if (next !== index) replacements.push({ start: a.start, end: a.end, text: spanText(a, next, edit.axis) });
      }
      continue;
    }
    const ia = indexOf(a, edit.axis);
    const ib = indexOf(b, edit.axis);
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    let newLo = lo;
    let newHi = hi;
    if (edit.deleted.size > 0) {
      while (newLo <= hi && edit.deleted.has(newLo)) newLo++;
      while (newHi >= lo && edit.deleted.has(newHi)) newHi--;
      if (newLo > hi || newHi < lo || newLo > newHi) {
        replacements.push({ start: a.sheetStart, end: b.end, text: "#REF!" });
        continue;
      }
    }
    const mappedLo = edit.map(newLo);
    const mappedHi = edit.map(newHi);
    const [nextA, nextB] = ia <= ib ? [mappedLo, mappedHi] : [mappedHi, mappedLo];
    if (nextA !== ia) replacements.push({ start: a.start, end: a.end, text: spanText(a, nextA, edit.axis) });
    if (nextB !== ib) replacements.push({ start: b.start, end: b.end, text: spanText(b, nextB, edit.axis) });
  }
  return applyReplacements(formula, replacements);
}

/** Rewrites sheet-qualified references when a sheet is renamed (`newName`) or deleted (`undefined`:
 * every reference to it becomes `#REF!`). */
export function rewriteFormulaForSheetChange(formula: string, oldName: string, newName: string | undefined): string {
  if (!parses(formula)) return formula;
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const { a, b } of segments(formula, scanReferences(formula))) {
    const sheet = a.sheet ?? b?.sheet;
    if (sheet !== oldName) continue;
    if (newName === undefined) {
      replacements.push({ start: a.sheetStart, end: (b ?? a).end, text: "#REF!" });
      continue;
    }
    const qualifier = `${formatSheetName(newName)}!`;
    if (a.sheet !== undefined) replacements.push({ start: a.sheetStart, end: a.start, text: qualifier });
    if (b && b.sheet !== undefined) replacements.push({ start: b.sheetStart, end: b.start, text: qualifier });
  }
  return applyReplacements(formula, replacements);
}
