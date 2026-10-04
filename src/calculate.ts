// Formula evaluation and sheet recalculation, per csvx-spec/spec/10-calculation.md and
// spec/07-functions.md. This is the one place in the project allowed to actually evaluate a
// formula's semantics (csvx-spec/AGENTS.md rule 1 — csvx-web must never grow its own copy of this).
//
// Decimal values are strings on the wire (schemas/formulas.schema.json, tests/README.md), so
// scale (digits after the decimal point) is tracked explicitly rather than left to floating point
// or to decimal.js's own normalization, which would silently drop a trailing zero that a human
// typed on purpose (e.g. "3.50").

import { Decimal } from "decimal.js";
import { columnIndexFromId } from "./columns.js";
import { FormulaParseError, parseFormula, type FormulaNode } from "./formula.js";

export type CellValueType = "blank" | "boolean" | "integer" | "decimal" | "string" | "date" | "time" | "datetime" | "error";

export interface CellValue {
  type: CellValueType;
  value?: unknown;
  code?: string;
  message?: string;
}

export interface ReferenceRequest {
  sheet?: string;
  column: string;
  row: number;
}

export type ReferenceResolver = (ref: ReferenceRequest) => CellValue;

export const BLANK: CellValue = { type: "blank" };

function errorValue(code: string, message?: string): CellValue {
  return message ? { type: "error", code, message } : { type: "error", code };
}

function isError(value: CellValue): boolean {
  return value.type === "error";
}

interface Numeric {
  decimal: Decimal;
  scale: number;
  isInteger: boolean;
}

function scaleOfDecimalString(text: string): number {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Coerces a CellValue to a numeric reading, or returns the VALUE/propagated error to produce
 * instead. Blanks count as zero (Core 1.0 doesn't define a "blank in arithmetic" error). */
function toNumeric(value: CellValue): Numeric | CellValue {
  if (isError(value)) return value;
  switch (value.type) {
    case "blank":
      return { decimal: new Decimal(0), scale: 0, isInteger: true };
    case "boolean":
      return { decimal: new Decimal(value.value ? 1 : 0), scale: 0, isInteger: true };
    case "integer":
      return { decimal: new Decimal(value.value as number), scale: 0, isInteger: true };
    case "decimal": {
      const text = String(value.value);
      return { decimal: new Decimal(text), scale: scaleOfDecimalString(text), isInteger: false };
    }
    case "string": {
      const text = (value.value as string).trim();
      if (text === "" || Number.isNaN(Number(text))) return errorValue("VALUE");
      return { decimal: new Decimal(text), scale: scaleOfDecimalString(text), isInteger: !text.includes(".") };
    }
    default:
      return errorValue("VALUE");
  }
}

function numericToCellValue(numeric: Numeric): CellValue {
  if (numeric.isInteger && numeric.decimal.isInteger()) {
    return { type: "integer", value: numeric.decimal.toNumber() };
  }
  const scale = Math.max(numeric.scale, 0);
  return { type: "decimal", value: numeric.decimal.toFixed(scale) };
}

function combineNumeric(a: Numeric, b: Numeric, operator: "+" | "-" | "*" | "/"): Numeric | CellValue {
  const bothInteger = a.isInteger && b.isInteger;
  switch (operator) {
    case "+":
    case "-": {
      const decimal = operator === "+" ? a.decimal.plus(b.decimal) : a.decimal.minus(b.decimal);
      return { decimal, scale: Math.max(a.scale, b.scale), isInteger: bothInteger && decimal.isInteger() };
    }
    case "*": {
      const decimal = a.decimal.times(b.decimal);
      return { decimal, scale: Math.max(a.scale + b.scale, 0), isInteger: bothInteger && decimal.isInteger() };
    }
    case "/": {
      if (b.decimal.isZero()) return errorValue("DIV0");
      const decimal = a.decimal.dividedBy(b.decimal);
      const exact = bothInteger && decimal.isInteger();
      return { decimal, scale: exact ? 0 : Math.max(a.scale, b.scale, 2), isInteger: exact };
    }
  }
}

function compareValues(a: CellValue, b: CellValue, operator: "=" | "!=" | "<" | "<=" | ">" | ">="): CellValue | boolean {
  if (isError(a)) return a;
  if (isError(b)) return b;
  const aNumeric = isNumericType(a) ? toNumeric(a) : null;
  const bNumeric = isNumericType(b) ? toNumeric(b) : null;
  if (aNumeric && "decimal" in aNumeric && bNumeric && "decimal" in bNumeric) {
    const cmp = aNumeric.decimal.comparedTo(bNumeric.decimal);
    return applyComparison(cmp, operator);
  }
  if (operator !== "=" && operator !== "!=") {
    if (!aNumeric || !bNumeric) return errorValue("VALUE");
  }
  const left = stringOf(a);
  const right = stringOf(b);
  const cmp = left < right ? -1 : left > right ? 1 : 0;
  return applyComparison(cmp, operator);
}

function isNumericType(value: CellValue): boolean {
  return value.type === "integer" || value.type === "decimal" || value.type === "boolean" || value.type === "blank" || (value.type === "string" && !Number.isNaN(Number((value.value as string).trim())));
}

function stringOf(value: CellValue): string {
  if (value.type === "blank") return "";
  if (value.type === "boolean") return value.value ? "TRUE" : "FALSE";
  return String(value.value ?? "");
}

function applyComparison(cmp: number, operator: "=" | "!=" | "<" | "<=" | ">" | ">="): boolean {
  switch (operator) {
    case "=":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
  }
}

function isTruthy(value: CellValue): CellValue | boolean {
  if (isError(value)) return value;
  if (value.type === "boolean") return Boolean(value.value);
  if (value.type === "integer" || value.type === "decimal") {
    const numeric = toNumeric(value);
    if (!("decimal" in numeric)) return numeric;
    return !numeric.decimal.isZero();
  }
  if (value.type === "string") {
    const upper = (value.value as string).trim().toUpperCase();
    if (upper === "TRUE") return true;
    if (upper === "FALSE") return false;
  }
  return errorValue("VALUE");
}

/** A declared workbook name, resolved to its parsed `refersTo` (spec/02-workbook.md). */
type NameTable = Map<string, FormulaNode | FormulaParseError>;

interface EvalContext {
  resolveRef: ReferenceResolver;
  names?: NameTable;
  /** Set while evaluating a name's own `refersTo`, where names are not allowed. */
  insideName?: boolean;
}

function buildNameTable(namedRanges: ReadonlyArray<{ name: string; refersTo: string }> | undefined): NameTable {
  const table: NameTable = new Map();
  for (const { name, refersTo } of namedRanges ?? []) {
    try {
      table.set(name.toLowerCase(), parseFormula(refersTo));
    } catch (error) {
      if (!(error instanceof FormulaParseError)) throw error;
      table.set(name.toLowerCase(), error);
    }
  }
  return table;
}

/** What a name stands for, or undefined when it is not declared (or is not usable here). */
function lookupName(node: FormulaNode & { kind: "name" }, ctx: EvalContext): FormulaNode | undefined {
  if (ctx.insideName) return undefined;
  const target = ctx.names?.get(node.name.toLowerCase());
  return target instanceof FormulaParseError ? undefined : target;
}

/** The values an aggregate argument contributes: a range (or a name that refers to one) expands to
 * its cells, anything else is a single value. */
function argumentValues(arg: FormulaNode, ctx: EvalContext): CellValue[] {
  if (arg.kind === "range") return flattenRangeValues(arg, ctx);
  if (arg.kind === "name") {
    const target = lookupName(arg, ctx);
    if (target?.kind === "range") return flattenRangeValues(target, { ...ctx, insideName: true });
  }
  return [evaluateNode(arg, ctx)];
}

function flattenRangeValues(node: FormulaNode & { kind: "range" }, ctx: EvalContext): CellValue[] {
  const startCol = columnIndexFromId(node.start.column);
  const endCol = columnIndexFromId(node.end.column);
  const startRow = node.start.row;
  const endRow = node.end.row;
  const minCol = Math.min(startCol, endCol);
  const maxCol = Math.max(startCol, endCol);
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const sheet = node.start.sheet ?? node.end.sheet;
  const values: CellValue[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      values.push(ctx.resolveRef({ sheet, column: columnIdFromIndex(col), row }));
    }
  }
  return values;
}

function columnIdFromIndex(index: number): string {
  let result = "";
  let n = index;
  while (n >= 0) {
    result = String.fromCharCode("A".charCodeAt(0) + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

const AGGREGATABLE = new Set(["integer", "decimal"]);

function evaluateCall(node: FormulaNode & { kind: "call" }, ctx: EvalContext): CellValue {
  const args = node.args;
  switch (node.name) {
    case "SUM": {
      let sum = new Decimal(0);
      let scale = 0;
      let sawDecimal = false;
      let sawAny = false;
      for (const arg of args) {
        const values = argumentValues(arg, ctx);
        for (const value of values) {
          if (isError(value)) return value;
          if (!AGGREGATABLE.has(value.type)) continue;
          const numeric = toNumeric(value);
          if (!("decimal" in numeric)) return numeric;
          sum = sum.plus(numeric.decimal);
          if (!numeric.isInteger) sawDecimal = true;
          scale = Math.max(scale, numeric.scale);
          sawAny = true;
        }
      }
      if (!sawAny) return { type: "integer", value: 0 };
      return numericToCellValue({ decimal: sum, scale, isInteger: !sawDecimal });
    }
    case "COUNT": {
      let count = 0;
      for (const arg of args) {
        const values = argumentValues(arg, ctx);
        for (const value of values) {
          if (isError(value)) return value;
          if (AGGREGATABLE.has(value.type)) count++;
        }
      }
      return { type: "integer", value: count };
    }
    case "IF": {
      if (args.length < 2 || args.length > 3) return errorValue("VALUE", "IF requires 2 or 3 arguments");
      const [condArg, thenArg, elseArg] = args;
      const truthy = isTruthy(evaluateNode(condArg as FormulaNode, ctx));
      if (typeof truthy !== "boolean") return truthy;
      if (truthy) return evaluateNode(thenArg as FormulaNode, ctx);
      return elseArg ? evaluateNode(elseArg, ctx) : BLANK;
    }
    case "ROUND": {
      if (args.length !== 2) return errorValue("VALUE", "ROUND requires 2 arguments");
      const [numberArg, digitsArg] = args;
      const number = toNumeric(evaluateNode(numberArg as FormulaNode, ctx));
      if (!("decimal" in number)) return number;
      const digitsValue = evaluateNode(digitsArg as FormulaNode, ctx);
      if (isError(digitsValue)) return digitsValue;
      if (digitsValue.type !== "integer") return errorValue("VALUE", "ROUND digits must be an integer");
      const digits = digitsValue.value as number;
      const rounded = number.decimal.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP);
      if (digits <= 0) return { type: "integer", value: rounded.toNumber() };
      return { type: "decimal", value: rounded.toFixed(digits) };
    }
    case "ABS": {
      if (args.length !== 1) return errorValue("VALUE", "ABS requires 1 argument");
      const number = toNumeric(evaluateNode(args[0] as FormulaNode, ctx));
      if (!("decimal" in number)) return number;
      return numericToCellValue({ decimal: number.decimal.abs(), scale: number.scale, isInteger: number.isInteger });
    }
    default:
      return errorValue("NAME");
  }
}

function evaluateNode(node: FormulaNode, ctx: EvalContext): CellValue {
  switch (node.kind) {
    case "number": {
      const isInteger = !node.value.includes(".");
      return isInteger ? { type: "integer", value: Number(node.value) } : { type: "decimal", value: node.value };
    }
    case "string":
      return { type: "string", value: node.value };
    case "boolean":
      return { type: "boolean", value: node.value };
    case "ref-error":
      return errorValue("REF");
    case "name": {
      const target = lookupName(node, ctx);
      return target ? evaluateNode(target, { ...ctx, insideName: true }) : errorValue("NAME");
    }
    case "reference":
      return ctx.resolveRef({ sheet: node.sheet, column: node.column, row: node.row });
    case "range": {
      const values = flattenRangeValues(node, ctx);
      return values[0] ?? BLANK;
    }
    case "call":
      return evaluateCall(node, ctx);
    case "unary": {
      const numeric = toNumeric(evaluateNode(node.operand, ctx));
      if (!("decimal" in numeric)) return numeric;
      const decimal = node.operator === "-" ? numeric.decimal.negated() : numeric.decimal;
      return numericToCellValue({ ...numeric, decimal });
    }
    case "percent": {
      const numeric = toNumeric(evaluateNode(node.operand, ctx));
      if (!("decimal" in numeric)) return numeric;
      return numericToCellValue({ decimal: numeric.decimal.dividedBy(100), scale: Math.max(numeric.scale + 2, 2), isInteger: false });
    }
    case "binary": {
      if (node.operator === "=" || node.operator === "!=" || node.operator === "<" || node.operator === "<=" || node.operator === ">" || node.operator === ">=") {
        const result = compareValues(evaluateNode(node.left, ctx), evaluateNode(node.right, ctx), node.operator);
        return typeof result === "boolean" ? { type: "boolean", value: result } : result;
      }
      const left = toNumeric(evaluateNode(node.left, ctx));
      if (!("decimal" in left)) return left;
      const right = toNumeric(evaluateNode(node.right, ctx));
      if (!("decimal" in right)) return right;
      const combined = combineNumeric(left, right, node.operator);
      if (!("decimal" in combined)) return combined;
      return numericToCellValue(combined);
    }
  }
}

/** Evaluates a formula string (including the leading "=") against a reference resolver. Parse
 * errors surface as a NAME error rather than throwing, since a formula cell with invalid syntax
 * is still a valid cell state the UI must be able to render. */
export function evaluateFormula(formula: string, resolveRef: ReferenceResolver): CellValue {
  let ast: FormulaNode;
  try {
    ast = parseFormula(formula);
  } catch (error) {
    if (error instanceof FormulaParseError) return errorValue("NAME", error.message);
    throw error;
  }
  return evaluateNode(ast, { resolveRef });
}

export interface FormulaCellInput {
  formula?: string;
  value?: CellValue;
}

export type CellMap = Record<string, FormulaCellInput>;

export interface RecalculateOptions {
  /** Resolves a sheet name referenced by `Sheet!A1` syntax to its own cell map. Cross-sheet
   * references read that sheet's literal/cached values; they aren't included in this sheet's own
   * dependency graph, so a cross-sheet cycle isn't detected (same scope as the conformance vectors,
   * which are single-sheet only). */
  resolveSheet?: (sheetName: string) => CellMap | undefined;
}

function referenceCoordinate(ref: { sheet?: string; column: string; row: number }): string {
  return `${ref.column}${ref.row + 1}`;
}

type Ref = { sheet?: string; column: string; row: number };
type RangeRef = { sheet?: string; from: { column: number; row: number }; to: { column: number; row: number } };

/** Collects the single-cell references and the ranges a formula reads. */
function collectReferences(node: FormulaNode, cells: Ref[], ranges: RangeRef[], names: NameTable, insideName = false): void {
  switch (node.kind) {
    case "name": {
      const target = insideName ? undefined : names.get(node.name.toLowerCase());
      if (target && !(target instanceof FormulaParseError)) collectReferences(target, cells, ranges, names, true);
      return;
    }
    case "reference":
      cells.push(node);
      return;
    case "range": {
      const a = columnIndexFromId(node.start.column);
      const b = columnIndexFromId(node.end.column);
      ranges.push({
        sheet: node.start.sheet ?? node.end.sheet,
        from: { column: Math.min(a, b), row: Math.min(node.start.row, node.end.row) },
        to: { column: Math.max(a, b), row: Math.max(node.start.row, node.end.row) },
      });
      return;
    }
    case "call":
      for (const arg of node.args) collectReferences(arg, cells, ranges, names, insideName);
      return;
    case "unary":
    case "percent":
      collectReferences(node.operand, cells, ranges, names, insideName);
      return;
    case "binary":
      collectReferences(node.left, cells, ranges, names, insideName);
      collectReferences(node.right, cells, ranges, names, insideName);
      return;
    default:
      return;
  }
}

/** Recalculates every formula cell across a set of named sheets in dependency order, per
 * spec/10-calculation.md. The graph has an edge for every cell a formula reads — each cell inside a
 * range, and cells on other sheets — so a reference to another sheet's formula cell sees its
 * calculated value, and a cycle that crosses sheets is CYCLE in every cell on it. A reference to a
 * sheet that is not in `sheets` is REF. A declared name contributes the edges of its `refersTo`.
 * Returns results only for cells that had a `formula`. */
export function recalculateSheets(
  sheets: Record<string, CellMap>,
  external?: (sheetName: string) => CellMap | undefined,
  namedRanges?: ReadonlyArray<{ name: string; refersTo: string }>,
): Record<string, Record<string, CellValue>> {
  const names = buildNameTable(namedRanges);
  interface Node {
    sheet: string;
    coordinate: string;
    ast: FormulaNode | FormulaParseError;
    deps: string[];
  }
  const idOf = (sheet: string, coordinate: string) => `${sheet}\n${coordinate}`;
  const nodes = new Map<string, Node>();
  const formulaCellsBySheet = new Map<string, Array<{ id: string; column: number; row: number }>>();

  for (const [sheet, cells] of Object.entries(sheets)) {
    const list: Array<{ id: string; column: number; row: number }> = [];
    for (const [coordinate, cell] of Object.entries(cells)) {
      if (!cell.formula) continue;
      const match = /^([A-Z]+)(\d+)$/.exec(coordinate);
      const id = idOf(sheet, coordinate);
      let ast: FormulaNode | FormulaParseError;
      try {
        ast = parseFormula(cell.formula);
      } catch (error) {
        if (!(error instanceof FormulaParseError)) throw error;
        ast = error;
      }
      nodes.set(id, { sheet, coordinate, ast, deps: [] });
      if (match) list.push({ id, column: columnIndexFromId(match[1] as string), row: Number(match[2]) - 1 });
    }
    formulaCellsBySheet.set(sheet, list);
  }

  for (const node of nodes.values()) {
    if (node.ast instanceof FormulaParseError) continue;
    const cells: Ref[] = [];
    const ranges: RangeRef[] = [];
    collectReferences(node.ast, cells, ranges, names);
    for (const ref of cells) {
      const id = idOf(ref.sheet ?? node.sheet, referenceCoordinate(ref));
      if (nodes.has(id)) node.deps.push(id);
    }
    for (const range of ranges) {
      for (const candidate of formulaCellsBySheet.get(range.sheet ?? node.sheet) ?? []) {
        if (candidate.column >= range.from.column && candidate.column <= range.to.column && candidate.row >= range.from.row && candidate.row <= range.to.row) node.deps.push(candidate.id);
      }
    }
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  const cyclic = new Set<string>();
  const order: string[] = [];
  const stack: string[] = [];

  function visit(id: string): void {
    const state = color.get(id) ?? WHITE;
    if (state === BLACK) return;
    if (state === GRAY) {
      for (const member of stack.slice(stack.indexOf(id))) cyclic.add(member);
      return;
    }
    color.set(id, GRAY);
    stack.push(id);
    for (const dep of (nodes.get(id) as Node).deps) visit(dep);
    stack.pop();
    color.set(id, BLACK);
    order.push(id);
  }
  for (const id of nodes.keys()) visit(id);

  const results = new Map<string, CellValue>();

  function resolver(own: string): ReferenceResolver {
    return (ref) => {
      const sheet = ref.sheet ?? own;
      const cells = sheets[sheet] ?? (ref.sheet ? external?.(sheet) : undefined);
      if (!cells) return errorValue("REF");
      const coordinate = referenceCoordinate(ref);
      const id = idOf(sheet, coordinate);
      if (cyclic.has(id)) return errorValue("CYCLE");
      const computed = results.get(id);
      if (computed) return computed;
      const cell = cells[coordinate];
      if (!cell || cell.formula) return BLANK;
      return cell.value ?? BLANK;
    };
  }

  for (const id of order) {
    if (cyclic.has(id)) continue;
    const node = nodes.get(id) as Node;
    results.set(id, node.ast instanceof FormulaParseError ? errorValue("NAME", node.ast.message) : evaluateNode(node.ast, { resolveRef: resolver(node.sheet), names }));
  }
  for (const id of cyclic) results.set(id, errorValue("CYCLE"));

  const out: Record<string, Record<string, CellValue>> = {};
  for (const sheet of Object.keys(sheets)) out[sheet] = {};
  for (const [id, node] of nodes) out[node.sheet]![node.coordinate] = results.get(id) as CellValue;
  return out;
}

/** Recalculates every formula cell in a single-sheet coordinate map, in dependency order, per
 * spec/10-calculation.md. Returns a result only for cells that had a `formula` — plain value cells
 * are inputs, not outputs. Cells participating in a circular dependency all resolve to CYCLE. */
export function recalculateCells(cells: CellMap, options: RecalculateOptions = {}): Record<string, CellValue> {
  const SELF = "\u0000self";
  return recalculateSheets({ [SELF]: cells }, options.resolveSheet)[SELF] as Record<string, CellValue>;
}
