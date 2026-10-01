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

interface EvalContext {
  resolveRef: ReferenceResolver;
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
        const values = arg.kind === "range" ? flattenRangeValues(arg, ctx) : [evaluateNode(arg, ctx)];
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
        const values = arg.kind === "range" ? flattenRangeValues(arg, ctx) : [evaluateNode(arg, ctx)];
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

function collectReferences(node: FormulaNode, into: Array<{ sheet?: string; column: string; row: number }>): void {
  switch (node.kind) {
    case "reference":
      into.push(node);
      return;
    case "range":
      into.push(node.start, node.end);
      return;
    case "call":
      for (const arg of node.args) collectReferences(arg, into);
      return;
    case "unary":
    case "percent":
      collectReferences(node.operand, into);
      return;
    case "binary":
      collectReferences(node.left, into);
      collectReferences(node.right, into);
      return;
    default:
      return;
  }
}

/** Recalculates every formula cell in a single-sheet coordinate map, in dependency order, per
 * spec/10-calculation.md. Returns a result only for cells that had a `formula` — plain value cells
 * are inputs, not outputs. Cells participating in a circular dependency all resolve to CYCLE. */
export function recalculateCells(cells: CellMap, options: RecalculateOptions = {}): Record<string, CellValue> {
  const asts = new Map<string, FormulaNode | FormulaParseError>();
  const deps = new Map<string, Set<string>>();

  for (const [coordinate, cell] of Object.entries(cells)) {
    if (!cell.formula) continue;
    try {
      const ast = parseFormula(cell.formula);
      asts.set(coordinate, ast);
      const refs: Array<{ sheet?: string; column: string; row: number }> = [];
      collectReferences(ast, refs);
      const localDeps = new Set<string>();
      for (const ref of refs) {
        if (ref.sheet) continue; // cross-sheet refs aren't part of this sheet's cycle graph
        localDeps.add(referenceCoordinate(ref));
      }
      deps.set(coordinate, localDeps);
    } catch (error) {
      if (error instanceof FormulaParseError) {
        asts.set(coordinate, error);
        deps.set(coordinate, new Set());
      } else {
        throw error;
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

  function visit(coordinate: string): void {
    const state = color.get(coordinate) ?? WHITE;
    if (state === BLACK) return;
    if (state === GRAY) {
      const cycleStart = stack.indexOf(coordinate);
      for (const node of stack.slice(cycleStart)) cyclic.add(node);
      return;
    }
    if (!deps.has(coordinate)) return; // not a formula cell — a plain input, not part of the graph
    color.set(coordinate, GRAY);
    stack.push(coordinate);
    for (const dep of deps.get(coordinate) ?? []) visit(dep);
    stack.pop();
    color.set(coordinate, BLACK);
    order.push(coordinate);
  }

  for (const coordinate of asts.keys()) visit(coordinate);

  const results: Record<string, CellValue> = {};

  function lookupLocal(coordinate: string): CellValue {
    if (cyclic.has(coordinate)) return errorValue("CYCLE");
    if (results[coordinate]) return results[coordinate];
    const cell = cells[coordinate];
    if (!cell) return BLANK;
    if (cell.formula) return BLANK; // not yet evaluated in this pass (shouldn't happen given topological order)
    return cell.value ?? BLANK;
  }

  function resolveRef(ref: ReferenceRequest): CellValue {
    if (ref.sheet) {
      const sheetCells = options.resolveSheet?.(ref.sheet);
      if (!sheetCells) return errorValue("REF");
      const coordinate = referenceCoordinate(ref);
      const cell = sheetCells[coordinate];
      if (!cell) return BLANK;
      return cell.value ?? BLANK;
    }
    return lookupLocal(referenceCoordinate(ref));
  }

  for (const coordinate of order) {
    if (cyclic.has(coordinate)) continue;
    const parsed = asts.get(coordinate);
    if (parsed instanceof FormulaParseError) {
      results[coordinate] = errorValue("NAME", parsed.message);
      continue;
    }
    if (!parsed) continue;
    results[coordinate] = evaluateNode(parsed, { resolveRef });
  }
  for (const coordinate of cyclic) {
    results[coordinate] = errorValue("CYCLE");
  }

  return results;
}
