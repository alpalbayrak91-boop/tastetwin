import { build } from "esbuild";

await build({
  entryPoints: ["server.mjs"],
  outfile: "desktop/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  minify: false,
  sourcemap: false,
});

console.log("TasteTwin desktop server bundled");
