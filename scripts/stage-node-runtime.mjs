import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const runtimeDir = path.join(repoRoot, "bundled-runtime");
const sourceNode = realpathSync(process.execPath);
const nodeFileName = path.basename(sourceNode);
const stagedNode = path.join(runtimeDir, nodeFileName);
const licenseCandidates = [
  path.join(path.dirname(sourceNode), "LICENSE"),
  path.join(path.dirname(sourceNode), "LICENSE.txt"),
];

mkdirSync(runtimeDir, { recursive: true });
copyFileSync(sourceNode, stagedNode);

for (const licensePath of licenseCandidates) {
  if (existsSync(licensePath)) {
    copyFileSync(licensePath, path.join(runtimeDir, "LICENSE-node.txt"));
    break;
  }
}

writeFileSync(
  path.join(runtimeDir, "node-runtime.json"),
  JSON.stringify(
    {
      version: process.version,
      execPath: sourceNode,
      platform: process.platform,
      arch: process.arch,
    },
    null,
    2,
  ) + "\n",
);

console.log(`Staged Node runtime ${process.version} from ${sourceNode}`);
