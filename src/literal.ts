// Canonical literal forms of csvx-spec/spec/04-data-types.md ("Literal forms"): exact,
// case-sensitive, no trimming, no locale handling. Shared by untyped cell resolution and CSV
// import inference; mirrors csvx-go's literal.go.

export type LiteralType = "blank" | "boolean" | "integer" | "decimal" | "date" | "time" | "datetime" | "string";

const INTEGER = /^-?(?:0|[1-9][0-9]*)$/;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)\.[0-9]+$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] as number);
}

export function literalType(text: string): LiteralType {
  if (text === "") return "blank";
  if (text === "true" || text === "false") return "boolean";
  if (text === "-0") return "string";
  if (INTEGER.test(text)) return "integer";
  if (DECIMAL.test(text)) return "decimal";
  let match = DATE.exec(text);
  if (match) return isRealDate(Number(match[1]), Number(match[2]), Number(match[3])) ? "date" : "string";
  if (TIME.test(text)) return "time";
  match = DATETIME.exec(text);
  if (match) return isRealDate(Number(match[1]), Number(match[2]), Number(match[3])) ? "datetime" : "string";
  return "string";
}
