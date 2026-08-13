import { mkdir, readFile, writeFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const runtimePackage = {
  name: packageJson.name,
  version: packageJson.version,
  private: true,
  main: "index.js",
  type: "commonjs",
  engines: packageJson.engines,
};

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/package.json", import.meta.url), `${JSON.stringify(runtimePackage, null, 2)}\n`);
