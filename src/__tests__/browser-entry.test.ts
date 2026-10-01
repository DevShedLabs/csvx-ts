// Regression guard for the browser/Node split: ./browser.ts must never import node.ts (directly
// or transitively), or a bundler targeting a browser would try to resolve node:fs/promises and
// fail. Static source-text checks rather than a bundler run, since that's what actually matters —
// this file's import graph — and doesn't require pulling Vite/webpack into this package's tests.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as browserEntry from "../browser.js";

describe("browser entry point", () => {
  it("does not import node.ts", async () => {
    const source = await readFile(path.join(import.meta.dirname, "..", "browser.ts"), "utf8");
    const importSpecifiers = [...source.matchAll(/from ["']([^"']+)["']/g)].map((match) => match[1]);
    expect(importSpecifiers).not.toContain("./node.js");
    expect(importSpecifiers.some((specifier) => specifier.startsWith("node:"))).toBe(false);
  });

  it("exports the browser-safe package API", () => {
    expect(typeof browserEntry.loadWorkbookFromZip).toBe("function");
    expect(typeof browserEntry.writeWorkbookToZip).toBe("function");
    expect(typeof browserEntry.validateBuffer).toBe("function");
    expect(typeof browserEntry.parseCSV).toBe("function");
    expect(typeof browserEntry.stringifyCSV).toBe("function");
    expect(typeof browserEntry.columnId).toBe("function");
  });

  it("validateBuffer classifies a non-ZIP buffer without touching the filesystem", async () => {
    const result = await browserEntry.validateBuffer(new TextEncoder().encode("not a zip"));
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.severity).toBe("error");
  });
});
