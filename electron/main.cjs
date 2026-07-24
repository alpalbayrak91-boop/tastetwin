const { app, BrowserWindow, dialog, shell } = require("electron");
const { appendFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_URL = "http://127.0.0.1:5173/";
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let mainWindow;

if (!gotSingleInstanceLock) {
  app.quit();
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
