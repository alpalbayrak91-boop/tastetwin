import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artifacts = path.join(root, ".codex-artifacts");
await mkdir(artifacts, { recursive: true });
const directory = await mkdtemp(path.join(artifacts, "unit-"));
try {
  const outfile = path.join(directory, "core.test.mjs");
  await build({ entryPoints: [path.join(root, "tests/core.test.ts")], outfile, bundle: true, platform: "node", format: "esm", packages: "external" });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--test", outfile], { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  if (!directory.startsWith(`${artifacts}${path.sep}`)) throw new Error("Unsafe test directory");
  await rm(directory, { recursive: true, force: true });
}
