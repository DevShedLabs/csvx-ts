// Print pagination and the used range, implementing csvx-spec/spec/03-sheets.md ("Used range" and
// "Pagination"). Both are pure functions of a sheet, its styles, and its `print` settings, with no
// DOM or renderer in sight, so every consumer (csvx-web, a CLI, a server) gets the same pages.
// Rows are A1 row numbers (the header is row 1) and columns are letters.

import { columnId, columnIndexFromId } from "./columns.js";
import { HEADER_ROW, coordinateFor, rawCellText, rowNumberFor } from "./coordinates.js";
import { columnWidthToPixels, rowHeightToPixels } from "./layout.js";
import type { Sheet, Style } from "./model.js";

const DPI = 96;
const DEFAULT_COLUMN_WIDTH = 8.43;
const DEFAULT_ROW_POINTS = 15;
const FIT_EPSILON = 1e-6;

/** Paper sizes in inches, portrait (width, height). */
const PAPER_INCHES: Record<string, [number, number]> = {
  letter: [8.5, 11],
  legal: [8.5, 14],
  tabloid: [11, 17],
  a3: [11.69, 16.54],
  a4: [8.27, 11.69],
  a5: [5.83, 8.27],
};

const EDGES = ["top", "right", "bottom", "left"] as const;

function hasVisibleEdge(style: Style | undefined): boolean {
  const border = (style?.border ?? {}) as Record<string, any>;
  return EDGES.some((edge) => {
    const declared = { style: border.style, color: border.color, ...(border[edge] ?? {}) };
    return Boolean(declared.style || declared.color) && declared.style !== "none";
  });
}

/** The rows and columns up to the last cell that prints something (spec/03-sheets.md, "Used
 * range"); always at least 1 × 1. */
export function usedRange(sheet: Pick<Sheet, "columns" | "records" | "cells">, styles?: Style[]): { rows: number; columns: number } {
  const byId = new Map((styles ?? []).map((style) => [style.id, style]));
  let rows = 1;
  let columns = 1;
  for (let row = HEADER_ROW; row < sheet.records.length; row++) {
    sheet.columns.forEach((_, column) => {
      const metadata = sheet.cells?.[coordinateFor(column, row)];
      const style = metadata?.style ? byId.get(metadata.style) : undefined;
      const prints = Boolean(metadata?.formula) || Boolean((style?.fill as { color?: string } | undefined)?.color) || hasVisibleEdge(style);
      if (rawCellText(sheet, row, column) !== "" || prints) {
        rows = Math.max(rows, rowNumberFor(row));
        columns = Math.max(columns, column + 1);
      }
    });
  }
  return { rows, columns };
}

export interface Page {
  /** 1-based page number. */
  number: number;
  /** A1 row numbers shown, repeated rows first. */
  rows: number[];
  /** Column letters shown, repeated columns first. */
  columns: string[];
}

export interface Pagination {
  /** The printable area inside the margins, in unscaled CSS pixels. */
  printable: { width: number; height: number };
  scale: number;
  /** The printed area as an A1 range, or "" when nothing is left to print. */
  area: string;
  pages: Page[];
}

const RANGE = /^([A-Z]+)([1-9][0-9]*):([A-Z]+)([1-9][0-9]*)$/;

function span(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, offset) => from + offset);
}

interface Repeat {
  end: number;
  indices: number[];
}

/** Splits indices into groups that fit `limit`, honoring forced breaks (1-based "break after item
 * n") and prepending the repeated items to every group that does not start at or before them. */
function splitIntoGroups(indices: number[], sizeOf: (index: number) => number, limit: number, breaksAfter: Set<number>, repeat: Repeat | null): number[][] {
  const repeatSize = repeat ? repeat.indices.reduce((sum, index) => sum + sizeOf(index), 0) : 0;
  const overheadFor = (first: number) => (repeat && first > repeat.end ? repeatSize : 0);
  const groups: number[][] = [];
  let current: number[] = [];
  let used = 0;
  for (const index of indices) {
    const size = sizeOf(index);
    if (current.length === 0) used = overheadFor(index);
    if (current.length > 0 && used + size > limit + FIT_EPSILON) {
      groups.push(current);
      current = [];
      used = overheadFor(index);
    }
    current.push(index);
    used += size;
    if (breaksAfter.has(index + 1)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Lays a sheet's print area out as pages, exactly as spec/03-sheets.md ("Pagination") describes. */
export function paginate(sheet: Pick<Sheet, "columns" | "records" | "cells" | "rowHeights" | "print">, styles?: Style[]): Pagination {
  const print = (sheet.print ?? {}) as Record<string, any>;
  const orientation = print.orientation ?? "portrait";
  const [paperW, paperH] = ((): [number, number] => {
    const [w, h] = PAPER_INCHES[print.paperSize ?? "letter"] ?? (PAPER_INCHES.letter as [number, number]);
    return orientation === "landscape" ? [h, w] : [w, h];
  })();
  const margins = { top: 0.75, right: 0.7, bottom: 0.75, left: 0.7, ...(print.margins ?? {}) };
  const printable = {
    width: Math.max(1, (paperW - margins.left - margins.right) * DPI),
    height: Math.max(1, (paperH - margins.top - margins.bottom) * DPI),
  };

  const columnPx = (index: number) => columnWidthToPixels(sheet.columns[index]?.width ?? DEFAULT_COLUMN_WIDTH);
  const rowPx = (index: number) => {
    const points = sheet.rowHeights?.[index + 1];
    return rowHeightToPixels(typeof points === "number" && points > 0 ? points : DEFAULT_ROW_POINTS);
  };

  const declared = typeof print.area === "string" ? RANGE.exec(print.area) : null;
  const used = usedRange(sheet, styles);
  const area = declared
    ? {
        r0: Math.min(Number(declared[2]), Number(declared[4])) - 1,
        r1: Math.min(Math.max(Number(declared[2]), Number(declared[4])) - 1, sheet.records.length),
        c0: Math.min(columnIndexFromId(declared[1] as string), columnIndexFromId(declared[3] as string)),
        c1: Math.min(Math.max(columnIndexFromId(declared[1] as string), columnIndexFromId(declared[3] as string)), sheet.columns.length - 1),
      }
    : { r0: 0, r1: used.rows - 1, c0: 0, c1: used.columns - 1 };
  const rowIndices = span(area.r0, area.r1);
  const columnIndices = span(area.c0, area.c1);
  const areaText = rowIndices.length > 0 && columnIndices.length > 0 ? `${columnId(area.c0)}${area.r0 + 1}:${columnId(area.c1)}${area.r1 + 1}` : "";

  const repeatOf = (text: unknown, kind: "rows" | "columns"): Repeat | null => {
    const match = (kind === "rows" ? /^([1-9][0-9]*):([1-9][0-9]*)$/ : /^([A-Z]+):([A-Z]+)$/).exec(typeof text === "string" ? text : "");
    if (!match) return null;
    const [a, b] = kind === "rows" ? [Number(match[1]) - 1, Number(match[2]) - 1] : [columnIndexFromId(match[1] as string), columnIndexFromId(match[2] as string)];
    const indices = span(Math.min(a, b), Math.max(a, b));
    return { end: Math.max(a, b), indices };
  };
  const repeatRows = repeatOf(print.repeatRows, "rows");
  const repeatColumns = repeatOf(print.repeatColumns, "columns");
  const sum = (indices: number[], size: (i: number) => number) => indices.reduce((total, index) => total + size(index), 0);

  const fitWidth = typeof print.fitToWidth === "number" && print.fitToWidth > 0 ? print.fitToWidth : 0;
  const fitHeight = typeof print.fitToHeight === "number" && print.fitToHeight > 0 ? print.fitToHeight : 0;
  let scale = (typeof print.scale === "number" ? print.scale : 100) / 100;
  if (print.fitToWidth !== undefined || print.fitToHeight !== undefined) {
    const candidates = [1];
    if (fitWidth) candidates.push((fitWidth * printable.width) / (sum(columnIndices, columnPx) + (fitWidth - 1) * (repeatColumns ? sum(repeatColumns.indices, columnPx) : 0)));
    if (fitHeight) candidates.push((fitHeight * printable.height) / (sum(rowIndices, rowPx) + (fitHeight - 1) * (repeatRows ? sum(repeatRows.indices, rowPx) : 0)));
    scale = Math.min(...candidates);
  }
  scale = Math.min(4, Math.max(0.1, scale));

  const columnGroups = splitIntoGroups(columnIndices, columnPx, printable.width / scale, new Set<number>(print.columnBreaks ?? []), repeatColumns);
  const rowGroups = splitIntoGroups(rowIndices, rowPx, printable.height / scale, new Set<number>(print.rowBreaks ?? []), repeatRows);
  const withRepeat = (group: number[], repeat: Repeat | null) => (repeat && (group[0] as number) > repeat.end ? [...repeat.indices, ...group] : group);

  const pages: Page[] = [];
  const across = print.pageOrder === "overThenDown";
  const outer = across ? rowGroups : columnGroups;
  const inner = across ? columnGroups : rowGroups;
  for (const outerGroup of outer) {
    for (const innerGroup of inner) {
      const columnGroup = across ? innerGroup : outerGroup;
      const rowGroup = across ? outerGroup : innerGroup;
      pages.push({
        number: pages.length + 1,
        rows: withRepeat(rowGroup, repeatRows).map((index) => index + 1),
        columns: withRepeat(columnGroup, repeatColumns).map(columnId),
      });
    }
  }
  return { printable, scale, area: areaText, pages };
}
