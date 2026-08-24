import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../webtask.json", import.meta.url), "utf8"));
const requiredFields = [
  "title",
  "name",
  "version",
  "author",
  "repository",
  "keywords",
  "useHashName",
  "description",
  "type",
  "category",
  "initialUrlPath",
  "auth0",
];

for (const field of requiredFields) {
  if (!(field in manifest)) throw new Error(`webtask.json is missing required field: ${field}`);
}

if ("secrets" in manifest && Object.keys(manifest.secrets).length === 0) {
  throw new Error("webtask.json.secrets must be omitted entirely, not an empty object.");
}
if (manifest.type !== "application") throw new Error('webtask.json.type must be "application".');
if (manifest.category !== "end_user") throw new Error('webtask.json.category must be "end_user".');
if (manifest.initialUrlPath !== "/") throw new Error('webtask.json.initialUrlPath must be "/".');
if (manifest.auth0?.createClient !== true) throw new Error("This template requires auth0.createClient: true.");
if (
  manifest.auth0?.scopes !==
  "read:resource_servers create:resource_servers read:connections update:connections read:tenant_settings"
) {
  throw new Error("This template requires the minimal Management API scopes for setup.");
}

console.log("Validated Auth0 Custom Extension manifest.");
