/** Converts a zero-based column index to its spreadsheet-style letter ID (0 -> "A", 26 -> "AA"). */
export function columnId(index: number): string {
  let result = "";
  while (index >= 0) {
    result = String.fromCharCode("A".charCodeAt(0) + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}
