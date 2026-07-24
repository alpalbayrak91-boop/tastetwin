module.exports = {
  packagerConfig: {
    asar: true,
    icon: "electron/tastetwin-icon",
    executableName: "TasteTwin",
    ...(process.env.ELECTRON_ZIP_DIR ? { electronZipDir: process.env.ELECTRON_ZIP_DIR } : {}),
    ignore: [
      /^\/(?:\.git|\.agents|\.codex|data|out|src|scripts|extension|public|node_modules)(?:\/|$)/,
      /^\/(?:index\.html|server\.mjs|start-tastetwin\.cmd|tsconfig.*|vite\.config\.ts|package-lock\.json)$/,
    ],
  },
  rebuildConfig: {},
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "tastetwin",
        setupExe: "TasteTwin-Setup.exe",
        setupIcon: "electron/tastetwin-icon.ico",
      },
    },
  ],
};
