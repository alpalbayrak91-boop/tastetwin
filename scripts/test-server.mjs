import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function createTestServer({ entry = "server.mjs" } = {}) {
  const artifacts = path.join(root, ".codex-artifacts");
  await mkdir(artifacts, { recursive: true });
  const directory = await mkdtemp(path.join(artifacts, "server-"));
  let child;
  let url;
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
  };
  const start = async () => {
    await stop();
    url = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [path.join(root, entry)], {
        cwd: root,
        env: { ...process.env, PORT: "0", TASTETWIN_DATA_DIR: directory, TASTETWIN_DIST_DIR: path.join(root, "dist"), TASTETWIN_NO_OPEN: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Test server startup timed out: ${output}`)); }, 15000);
      child.stdout.on("data", (data) => {
        output += data.toString();
        const match = output.match(/TasteTwin live server: (http:\/\/127\.0\.0\.1:\d+)\//);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.stderr.on("data", (data) => { output += data.toString(); });
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Test server exited (${code}): ${output}`)); });
    });
  };
  const dispose = async () => {
    await stop();
    if (!directory.startsWith(`${artifacts}${path.sep}`)) throw new Error("Unsafe test data directory");
    await rm(directory, { recursive: true, force: true });
  };
  try { await start(); } catch (error) { await dispose(); throw error; }
  return { get url() { return url; }, start, stop, dispose };
}
