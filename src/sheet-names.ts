// Sheet names are compared ignoring ASCII case everywhere (csvx-spec spec/02-workbook.md,
// 06-formulas.md). Unicode case folding differs between engines, so only A-Z fold.

/** Lower-cases ASCII letters only. */
export function foldSheetName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Whether two sheet names are equal ignoring ASCII case. */
export function sameSheetName(a: string, b: string): boolean {
  return foldSheetName(a) === foldSheetName(b);
}

/** Rejects sheet names that collide ignoring ASCII case: formulas find a sheet by name, so two that
 * differ only in case would be ambiguous (spec/02-workbook.md). */
export function checkSheetNames(sheets: ReadonlyArray<{ name: string }>): void {
  const seen = new Map<string, string>();
  for (const sheet of sheets) {
    const key = foldSheetName(sheet.name);
    const first = seen.get(key);
    if (first !== undefined) throw new Error(`DUPLICATE_SHEET_NAME: sheet ${JSON.stringify(sheet.name)} has the same name as ${JSON.stringify(first)}, ignoring case`);
    seen.set(key, sheet.name);
  }
}
