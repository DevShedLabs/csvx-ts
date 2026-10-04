// Fails when package.json's version is behind the newest git tag. The csvx-* repos share one
// version tag (lockstep), and package.json used to be left at 0.1.6 while the tag was v0.1.11.
// Bump "version" before tagging; this only guards against forgetting to. Skipped outside a git
// checkout (e.g. when installed from npm).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
const behind = (a, b) => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

let tags;
try {
  tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
} catch {
  process.exit(0);
}
if (tags.length === 0) process.exit(0);
const newest = tags.map((t) => [t, parse(t)]).sort((x, y) => (behind(x[1], y[1]) ? -1 : behind(y[1], x[1]) ? 1 : 0)).pop();
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (behind(parse(version), newest[1])) {
  console.error(`check-version: package.json version ${version} is behind the newest tag ${newest[0]}; bump it before tagging.`);
  process.exit(1);
}
