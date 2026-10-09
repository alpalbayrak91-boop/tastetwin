import { build } from "esbuild";
import { chromium } from "playwright";
import { createTestServer } from "./test-server.mjs";

const server = await createTestServer();
let browser;
try {
  const bundle = await build({ entryPoints: ["src/lib/storage.ts"], bundle: true, write: false, format: "iife", globalName: "storage" });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route(server.url + "/", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Isolated storage test</title>" }));
  await page.goto(server.url);
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("tastetwin", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("state");
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put({ users: [{ id: "one", films: [{ rating: 4 }] }, { id: "two", films: [] }], activeId: "one" }, "app");
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const report = await page.evaluate(async () => {
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const originalPut = IDBObjectStore.prototype.put;
    let profileWrites = 0;
    IDBObjectStore.prototype.put = function (...args) { if (this.name === "profiles") profileWrites++; return originalPut.apply(this, args); };
    const legacy = await storage.loadPersistentState("app");
    assert(legacy.users.length === 2, "legacy data unreadable");
    await storage.savePersistentState("app", legacy);
    assert(profileWrites === 2, "migration must save both profiles");
    const migrated = await storage.loadPersistentState("app");
    assert(JSON.stringify(migrated.users) === JSON.stringify(legacy.users) && migrated.activeId === legacy.activeId, "migration lost data or ordering");
    profileWrites = 0;
    await storage.savePersistentState("app", { ...migrated, activeId: "two" });
    assert(profileWrites === 0, "settings must not rewrite films");
    const updated = { ...migrated, users: [{ ...migrated.users[0], films: [{ rating: 2 }] }, migrated.users[1]] };
    await storage.savePersistentState("app", updated);
    assert(profileWrites === 1, "one changed person must produce one profile write");
    let rejected = false;
    try {
      await storage.savePersistentState("app", { ...updated, users: [{ id: "one", films: [{ rating: 5 }] }, { id: "two", invalid: () => {} }] });
    } catch { rejected = true; }
    assert(rejected, "uncloneable write must fail");
    const afterFailure = await storage.loadPersistentState("app");
    assert(afterFailure.users[0].films[0].rating === 2, "failed transaction partially overwrote a profile");
    await Promise.all([
      storage.savePersistentState("app", { ...afterFailure, activeId: "one" }),
      storage.savePersistentState("app", { ...afterFailure, activeId: "two" }),
    ]);
    assert((await storage.loadPersistentState("app")).activeId === "two", "queued writes reordered");
    await storage.savePersistentState("app", { ...afterFailure, users: [afterFailure.users[0]] });
    const remaining = await storage.loadPersistentState("app");
    assert(remaining.users.length === 1, "backup restore retained removed profile");
    await storage.clearPersistentState("app");
    assert(await storage.loadPersistentState("app") === undefined, "reset did not clear state");
    const db = await new Promise(resolve => { const r = indexedDB.open("tastetwin"); r.onsuccess = () => resolve(r.result); });
    const count = await new Promise(resolve => { const r = db.transaction("profiles").objectStore("profiles").count(); r.onsuccess = () => resolve(r.result); });
    db.close();
    assert(count === 0, "reset left profile records behind");
    return { legacyMigration: true, unchangedProfileWrites: 0, changedProfileWrites: 1, failedWriteAtomic: true, orderedWrites: true, restoreAndReset: true };
  });
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.dispose();
}
