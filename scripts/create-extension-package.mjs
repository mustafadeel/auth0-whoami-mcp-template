import { mkdir, readFile, writeFile } from "node:fs/promises";
import { validate } from "webtask-json-validator";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const runtimePackage = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  author: packageJson.author,
  repository: packageJson.repository,
  keywords: packageJson.keywords,
  private: true,
  main: "extension.js",
  type: "commonjs",
  engines: packageJson.engines,
  license: packageJson.license,
  "auth0-extension": packageJson["auth0-extension"],
};

const result = validate(runtimePackage, true);
if (!result.isValid) {
  throw new Error(`dist/package.json fails Auth0's extension schema: ${JSON.stringify(result.errors)}`);
}

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await writeFile(new URL("../dist/package.json", import.meta.url), `${JSON.stringify(runtimePackage, null, 2)}\n`);
