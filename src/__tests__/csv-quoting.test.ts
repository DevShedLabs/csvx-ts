// None of csvx-spec/examples/*.csv exercise quoted fields (embedded commas/quotes/newlines), so
// this one case is tested directly rather than through a real fixture — see csvx-spec/AGENTS.md
// rule 3.7: prefer real fixtures "wherever the behavior under test can be reached that way"; this
// is the one corner the fixtures don't reach, not a stand-in for fixture-based testing generally.

import { describe, expect, it } from "vitest";
import { parseCSV, stringifyCSV } from "../csv.js";

describe("CSV quoting", () => {
  it("round-trips a field containing a comma, a quote, and a newline", () => {
    const header = ["Name", "Note"];
    const records = [["Ada", 'Says "hi", warmly\nSecond line']];
    const text = stringifyCSV(header, records);
    const parsed = parseCSV(text);
    expect(parsed.header).toEqual(header);
    expect(parsed.records).toEqual(records);
  });

  it("accepts an empty column name (spec 03-sheets.md) and writes it back unchanged", () => {
    const parsed = parseCSV("A,,C\n1,2,3\n");
    expect(parsed.header).toEqual(["A", "", "C"]);
    expect(stringifyCSV(parsed.header, parsed.records)).toBe("A,,C\n1,2,3\n");
  });

  it("writes a record of one empty field as \"\" and reads it back as that field", () => {
    expect(stringifyCSV([""], [[""], ["x"]])).toBe('""\n""\nx\n');
    expect(parseCSV('""\n""\nx\n')).toEqual({ header: [""], records: [[""], ["x"]] });
  });

  it("rejects a record with the wrong number of fields", () => {
    expect(() => parseCSV("A,B\n1,2,3\n")).toThrow(/expected 2/);
  });
});
