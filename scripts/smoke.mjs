import { createRequire } from "node:module";
import http from "node:http";

const require = createRequire(import.meta.url);
const handler = require("../dist/extension.js");
if (typeof handler !== "function") {
  throw new Error(`Webtask requires the bundle to export a bare function, got ${typeof handler}`);
}
const context = {
  data: {
    AUTH0_DOMAIN: "tenant.example.auth0.com",
    AUTH0_CLIENT_ID: "client",
    AUTH0_CLIENT_SECRET: "secret",
    EXTENSION_SECRET: "01234567890123456789012345678901",
  },
  secrets: {},
};

function request(port, method, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", method, path, port }, (response) => {
      let body = "";
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolve({ body, location: response.headers.location, status: response.statusCode });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

const USE_WILDCARD_DOMAIN = 3;

const server = http.createServer((req, res) => {
  req.x_wt = { container: "auth0-whoami-mcp", jtn: "auth0-whoami-mcp", url_format: USE_WILDCARD_DOMAIN };
  handler(context, req, res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

try {
  const port = server.address().port;
  const landing = await request(port, "GET", "/auth0-whoami-mcp/");
  const login = await request(port, "GET", "/auth0-whoami-mcp/.extensions/setup/login");
  const provision = await request(port, "POST", "/auth0-whoami-mcp/setup/provision");

  if (landing.status !== 200 || !landing.body.includes("Sign in and provision")) {
    throw new Error(`Unexpected landing response: ${landing.status}`);
  }
  if (login.status !== 302 || !String(login.location).includes("/authorize")) {
    throw new Error(`Unexpected login response: ${login.status} ${login.location}`);
  }
  if (provision.status !== 401) {
    throw new Error(`Expected unauthenticated provisioning to be rejected, received ${provision.status}`);
  }

  console.log(`landing=${landing.status} login=${login.status} provision=${provision.status}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
