const { app, autoUpdater, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_URL = "http://127.0.0.1:5173/";
// update.electronjs.org serves GitHub releases of public repos to Squirrel.Windows.
const UPDATE_FEED = "https://update.electronjs.org/alpalbayrak91-boop/tastetwin";
const UPDATE_CHECK_MS = 4 * 60 * 60 * 1000;
const handledSquirrelEvent = handleSquirrelEvent();
const gotSingleInstanceLock = !handledSquirrelEvent && app.requestSingleInstanceLock();
let mainWindow;

if (!gotSingleInstanceLock && !handledSquirrelEvent) {
  app.quit();
}

// Squirrel starts the app with these flags while installing or updating and
// waits for it to exit. Shortcuts are only created if the app asks for them.
function handleSquirrelEvent() {
  if (process.platform !== "win32") return false;
  const event = process.argv[1];
  if (!event?.startsWith("--squirrel-") || event === "--squirrel-firstrun") return false;
  const updateExe = path.resolve(path.dirname(process.execPath), "..", "Update.exe");
  const exeName = path.basename(process.execPath);
  const runUpdate = (args) => {
    try {
      spawn(updateExe, args, { detached: true }).on("close", () => app.quit()).on("error", () => app.quit());
    } catch {
      app.quit();
    }
  };
  if (event === "--squirrel-install" || event === "--squirrel-updated") runUpdate([`--createShortcut=${exeName}`]);
  else if (event === "--squirrel-uninstall") runUpdate([`--removeShortcut=${exeName}`]);
  else app.quit();
  return true;
}

function logUpdate(message) {
  try {
    appendFileSync(path.join(app.getPath("userData"), "update.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never block the app.
  }
}

function startAutoUpdates() {
  if (!app.isPackaged || process.platform !== "win32") return;
  // Squirrel holds its lock during the first run after install.
  if (process.argv.includes("--squirrel-firstrun")) return;
  autoUpdater.setFeedURL({ url: `${UPDATE_FEED}/${process.platform}-${process.arch}/${app.getVersion()}` });
  // Squirrel errors carry a long .NET stack; the first line is the useful part.
  autoUpdater.on("error", (error) => logUpdate(`error ${String(error?.message ?? error).split(/\r?\n/).find((line) => line.includes("Exception")) ?? ""}`.trim()));
  autoUpdater.on("update-available", () => logUpdate("downloading update"));
  autoUpdater.on("update-not-available", () => logUpdate(`up to date ${app.getVersion()}`));
  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    logUpdate(`downloaded ${releaseName ?? ""}`);
    void dialog
      .showMessageBox({
        type: "info",
        buttons: ["Yeniden baslat", "Sonra"],
        defaultId: 0,
        title: "TasteTwin guncellemesi",
        message: `Yeni surum indirildi${releaseName ? `: ${releaseName}` : ""}.`,
        detail: "Simdi yeniden baslatinca kurulur. Sonra dersen bir sonraki acilista kurulur.",
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });
  const check = () => {
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      logUpdate(`check failed ${error?.message ?? error}`);
    }
  };
  setTimeout(check, 10_000);
  setInterval(check, UPDATE_CHECK_MS);
}

async function startLocalApp() {
  process.env.PORT = "5173";
  process.env.TASTETWIN_DATA_DIR = path.join(app.getPath("userData"), "data");
  process.env.TASTETWIN_DIST_DIR = path.join(app.getAppPath(), "dist");
  const serverPath = path.join(app.getAppPath(), "desktop", "server.mjs");
  await import(pathToFileURL(serverPath).href);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#f5f2ea",
    icon: path.join(app.getAppPath(), "electron", "tastetwin-icon-256.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.removeMenu();
  // The version in the title bar shows at a glance whether an update landed.
  window.setTitle(`TasteTwin ${app.getVersion()}`);
  window.on("page-title-updated", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  void window.loadURL(APP_URL);
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (gotSingleInstanceLock) app.whenReady()
  .then(async () => {
    await startLocalApp();
    createWindow();
    startAutoUpdates();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);
    appendFileSync(path.join(app.getPath("userData"), "startup-error.log"), `${new Date().toISOString()}\n${message}\n\n`);
    if (error?.code === "EADDRINUSE" || message.includes("EADDRINUSE")) {
      dialog.showMessageBoxSync({
        type: "info",
        title: "TasteTwin zaten acik",
        message: "TasteTwin zaten calisiyor.",
        detail: "Kurulum dosyasini yeniden acmana gerek yok. Acik TasteTwin penceresini kullanabilirsin.",
      });
    } else {
      dialog.showErrorBox("TasteTwin baslatilamadi", message);
    }
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
