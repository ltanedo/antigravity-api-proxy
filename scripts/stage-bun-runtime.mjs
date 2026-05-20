import {
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

function resolveBunPath() {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(locator, ["bun"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!output) {
    throw new Error("Could not find bun on PATH. Install Bun before building.");
  }

  return realpathSync(output);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runtimeDir = path.join(repoRoot, "bundled-runtime");
const sourceBun = resolveBunPath();
const bunFileName = path.basename(sourceBun);
const stagedBun = path.join(runtimeDir, bunFileName);
const licenseCandidates = [
  path.join(path.dirname(sourceBun), "LICENSE"),
  path.join(path.dirname(sourceBun), "LICENSE.txt"),
  path.join(path.dirname(sourceBun), "..", "LICENSE"),
  path.join(path.dirname(sourceBun), "..", "LICENSE.txt"),
];
const bunVersion = execFileSync(sourceBun, ["--version"], { encoding: "utf8" }).trim();

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
copyFileSync(sourceBun, stagedBun);

for (const licensePath of licenseCandidates) {
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, path.join(runtimeDir, "LICENSE-bun.txt"));
    break;
  }
}

writeFileSync(
  path.join(runtimeDir, "bun-runtime.json"),
  JSON.stringify(
    {
      version: bunVersion,
      execPath: sourceBun,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Staged Bun runtime ${bunVersion} from ${sourceBun}`);
