import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const extensionDirectory = path.join(root, "extension");
const outputDirectory = path.join(root, "public");
const archive = new JSZip();

await addDirectory(extensionDirectory);

await mkdir(outputDirectory, { recursive: true });
const bytes = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(path.join(outputDirectory, "tastetwin-extension.zip"), bytes);
console.log(`TasteTwin extension packaged (${bytes.length} bytes)`);

async function addDirectory(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await addDirectory(absolutePath, relativePath);
    } else if (entry.isFile()) {
      archive.file(relativePath, await readFile(absolutePath));
    }
  }
}
