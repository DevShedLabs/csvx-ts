/** Converts a zero-based column index to its spreadsheet-style letter ID (0 -> "A", 26 -> "AA"). */
export function columnId(index: number): string {
  let result = "";
  while (index >= 0) {
    result = String.fromCharCode("A".charCodeAt(0) + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  }
  return result;
}

/** Inverse of columnId: converts a spreadsheet-style letter ID to its zero-based column index
 * ("A" -> 0, "AA" -> 26). Case-insensitive. */
export function columnIndexFromId(id: string): number {
  let index = 0;
  for (const char of id.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - "A".charCodeAt(0) + 1);
  }
  return index - 1;
}
