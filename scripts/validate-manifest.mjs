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
  "runtime",
  "category",
  "initialUrlPath",
  "auth0",
  "secrets",
];

for (const field of requiredFields) {
  if (!(field in manifest)) throw new Error(`webtask.json is missing required field: ${field}`);
}

if (manifest.runtime !== "node22") throw new Error('webtask.json.runtime must be "node22".');
if (manifest.type !== "application") throw new Error('webtask.json.type must be "application".');
if (manifest.category !== "end_user") throw new Error('webtask.json.category must be "end_user".');
if (manifest.initialUrlPath !== "/") throw new Error('webtask.json.initialUrlPath must be "/".');
if (manifest.auth0?.createClient !== true) throw new Error("This template requires auth0.createClient: true.");
if (manifest.auth0?.scopes !== "read:resource_servers create:resource_servers") {
  throw new Error("This template requires the minimal resource-server Management API scopes.");
}

console.log("Validated Auth0 Custom Extension manifest.");
