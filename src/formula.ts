// Formula tokenizer + recursive-descent parser implementing the grammar in
// csvx-spec/spec/06-formulas.md literally:
//
//   formula    = "=" expression
//   expression = literal | reference | function | unary | binary | range | "(" expression ")"
//   binary     = expression operator expression
//   operator   = "+" "-" "*" "/" "%" "=" "!=" "<" "<=" ">" ">="
//   reference  = [sheet "!"] cell
//   range      = reference ":" reference
//
// Precedence (highest to lowest), per spec/06: unary signs, percent, multiplication/division,
// addition/subtraction, then comparisons. This module only produces an AST — evaluation lives in
// calculate.ts, which is where the actual arithmetic/function semantics belong.

export type FormulaNode =
  | { kind: "number"; value: string }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "reference"; sheet?: string; column: string; row: number }
  | { kind: "range"; start: FormulaNode & { kind: "reference" }; end: FormulaNode & { kind: "reference" } }
  | { kind: "call"; name: string; args: FormulaNode[] }
  | { kind: "unary"; operator: "+" | "-"; operand: FormulaNode }
  | { kind: "percent"; operand: FormulaNode }
  | { kind: "binary"; operator: "+" | "-" | "*" | "/" | "=" | "!=" | "<" | "<=" | ">" | ">="; left: FormulaNode; right: FormulaNode };

export class FormulaParseError extends Error {}

type Token =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "ident"; value: string } // bare word: reference, function name, or boolean literal
  | { type: "quoted-sheet"; value: string } // 'Sheet Name'! already unescaped, without the trailing "!"
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" }
  | { type: "comma" }
  | { type: "colon" }
  | { type: "bang" };

const CELL_PATTERN = /^([A-Za-z]+)(\d+)$/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma" });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ type: "colon" });
      i++;
      continue;
    }
    if (ch === "!") {
      tokens.push({ type: "bang" });
      i++;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < source.length) {
        if (source[j] === "'") {
          if (source[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += source[j];
        j++;
      }
      if (!closed) throw new FormulaParseError("Unterminated quoted sheet name");
      tokens.push({ type: "quoted-sheet", value });
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += source[j];
        j++;
      }
      if (!closed) throw new FormulaParseError("Unterminated string literal");
      tokens.push({ type: "string", value });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j] as string)) j++;
      tokens.push({ type: "number", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j] as string)) j++;
      tokens.push({ type: "ident", value: source.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "<" || ch === ">" || ch === "=" || ch === "!") {
      const two = source.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "!=") {
        tokens.push({ type: "op", value: two });
        i += 2;
        continue;
      }
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if ("+-*/%".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new FormulaParseError(`Unexpected character '${ch}'`);
  }
  return tokens;
}

/** Parses a formula string (including the leading "=") into an AST. Throws FormulaParseError on
 * invalid syntax, trailing tokens, or invalid references — per spec/06-formulas.md, parsing MUST
 * reject these rather than guess. */
export function parseFormula(source: string): FormulaNode {
  if (!source.startsWith("=")) throw new FormulaParseError("Formula must start with '='");
  const tokens = tokenize(source.slice(1));
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }
  function next(): Token {
    const token = tokens[pos];
    if (!token) throw new FormulaParseError("Unexpected end of formula");
    pos++;
    return token;
  }

  function parseReferenceFrom(sheet: string | undefined, cellToken: string): FormulaNode & { kind: "reference" } {
    const match = CELL_PATTERN.exec(cellToken);
    if (!match) throw new FormulaParseError(`Invalid cell reference '${cellToken}'`);
    const row = Number(match[2]);
    if (row < 1) throw new FormulaParseError(`Invalid cell reference '${cellToken}'`);
    return { kind: "reference", sheet, column: (match[1] as string).toUpperCase(), row: row - 1 };
  }

  function parsePrimary(): FormulaNode {
    const token = next();
    if (token.type === "number") return { kind: "number", value: token.value };
    if (token.type === "string") return { kind: "string", value: token.value };
    if (token.type === "lparen") {
      const expr = parseExpression();
      const close = next();
      if (close.type !== "rparen") throw new FormulaParseError("Expected ')'");
      return expr;
    }
    if (token.type === "quoted-sheet") {
      const bang = next();
      if (bang.type !== "bang") throw new FormulaParseError("Expected '!' after quoted sheet name");
      const cell = next();
      if (cell.type !== "ident") throw new FormulaParseError("Expected cell reference after sheet name");
      return finishReferenceOrRange(parseReferenceFrom(token.value, cell.value));
    }
    if (token.type === "ident") {
      if (peek()?.type === "bang") {
        next();
        const cell = next();
        if (cell.type !== "ident") throw new FormulaParseError("Expected cell reference after sheet name");
        return finishReferenceOrRange(parseReferenceFrom(token.value, cell.value));
      }
      if (peek()?.type === "lparen") {
        next();
        const args: FormulaNode[] = [];
        if (peek()?.type !== "rparen") {
          args.push(parseExpression());
          while (peek()?.type === "comma") {
            next();
            args.push(parseExpression());
          }
        }
        const close = next();
        if (close.type !== "rparen") throw new FormulaParseError("Expected ')'");
        return { kind: "call", name: token.value.toUpperCase(), args };
      }
      const upper = token.value.toUpperCase();
      if (upper === "TRUE" || upper === "FALSE") return { kind: "boolean", value: upper === "TRUE" };
      if (CELL_PATTERN.test(token.value)) return finishReferenceOrRange(parseReferenceFrom(undefined, token.value));
      throw new FormulaParseError(`Unexpected identifier '${token.value}'`);
    }
    throw new FormulaParseError("Unexpected token in formula");
  }

  function finishReferenceOrRange(start: FormulaNode & { kind: "reference" }): FormulaNode {
    if (peek()?.type === "colon") {
      next();
      const endToken = next();
      let end: FormulaNode & { kind: "reference" };
      if (endToken.type === "quoted-sheet") {
        const bang = next();
        if (bang.type !== "bang") throw new FormulaParseError("Expected '!' after quoted sheet name");
        const cell = next();
        if (cell.type !== "ident") throw new FormulaParseError("Expected cell reference");
        end = parseReferenceFrom(endToken.value, cell.value);
      } else if (endToken.type === "ident") {
        if (peek()?.type === "bang") {
          next();
          const cell = next();
          if (cell.type !== "ident") throw new FormulaParseError("Expected cell reference");
          end = parseReferenceFrom(endToken.value, cell.value);
        } else {
          end = parseReferenceFrom(undefined, endToken.value);
        }
      } else {
        throw new FormulaParseError("Expected reference after ':'");
      }
      return { kind: "range", start, end };
    }
    return start;
  }

  function parseUnary(): FormulaNode {
    const token = peek();
    if (token?.type === "op" && (token.value === "+" || token.value === "-")) {
      next();
      return { kind: "unary", operator: token.value, operand: parseUnary() };
    }
    return parsePostfix();
  }

  function peekOp(): string | undefined {
    const token = peek();
    return token?.type === "op" ? token.value : undefined;
  }

  function parsePostfix(): FormulaNode {
    let node = parsePrimary();
    while (peekOp() === "%") {
      next();
      node = { kind: "percent", operand: node };
    }
    return node;
  }

  function parseMultiplicative(): FormulaNode {
    let node = parseUnary();
    let op = peekOp();
    while (op === "*" || op === "/") {
      next();
      node = { kind: "binary", operator: op, left: node, right: parseUnary() };
      op = peekOp();
    }
    return node;
  }

  function parseAdditive(): FormulaNode {
    let node = parseMultiplicative();
    let op = peekOp();
    while (op === "+" || op === "-") {
      next();
      node = { kind: "binary", operator: op, left: node, right: parseMultiplicative() };
      op = peekOp();
    }
    return node;
  }

  const COMPARISON_OPS = new Set(["=", "!=", "<", "<=", ">", ">="]);

  function parseComparison(): FormulaNode {
    let node = parseAdditive();
    let op = peekOp();
    while (op !== undefined && COMPARISON_OPS.has(op)) {
      next();
      node = { kind: "binary", operator: op as "=" | "!=" | "<" | "<=" | ">" | ">=", left: node, right: parseAdditive() };
      op = peekOp();
    }
    return node;
  }

  function parseExpression(): FormulaNode {
    return parseComparison();
  }

  const result = parseExpression();
  if (pos < tokens.length) throw new FormulaParseError("Unexpected trailing tokens in formula");
  return result;
}
