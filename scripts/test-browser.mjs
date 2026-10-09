import { spawn } from "node:child_process";
import path from "node:path";
import { createTestServer, root } from "./test-server.mjs";

const server = await createTestServer({ entry: "desktop/server.mjs" });
try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-app.mjs"], {
      cwd: root,
      env: { ...process.env, TASTETWIN_APP_URL: server.url, TASTETWIN_SCREENSHOT: path.join(root, ".codex-artifacts", "tastetwin-verified.png") },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await server.dispose();
}
