import type { Request, RequestHandler, Response } from "express";
import express from "express";
import { ApiClient, ProtectedResourceMetadataBuilder } from "@auth0/auth0-api-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type ConfigReader = (key: string) => string | undefined;

const protectedResourceMetadataPath = "/.well-known/oauth-protected-resource";
const setupAdminPath = "/.extensions/setup";
const setupAudience = "urn:auth0-whoami-mcp-setup";
const setupSessionStorageKey = "auth0-whoami-mcp:setup-token";

interface WebtaskRequest extends Request {
  x_wt?: {
    ectx?: {
      PUBLIC_WT_URL?: unknown;
    };
  };
}

interface LegacyExtensionTools {
  middlewares: {
    authenticateAdmins: (options: Record<string, unknown>) => RequestHandler;
  };
  routes: {
    dashboardAdmins: (options: Record<string, unknown>) => RequestHandler;
  };
}

interface ResourceServer {
  id: string;
  identifier: string;
}

interface SetupAdminAuth {
  authenticate: RequestHandler;
  routes: RequestHandler;
}

class ManagementApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function readConfig(config: ConfigReader, key: string): string | undefined {
  const value = config(key)?.trim();
  return value || undefined;
}

function toAuth0Domain(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

function tenantOrigin(config: ConfigReader): string {
  const domain = readConfig(config, "AUTH0_DOMAIN");
  if (!domain) {
    throw new Error("Auth0 runtime settings are unavailable. Update or reinstall the extension with its managed client enabled.");
  }

  return `https://${toAuth0Domain(domain)}`;
}

function requestHeader(req: Request, name: string): string | undefined {
  if (typeof req.header === "function") {
    const expressValue = req.header(name);
    if (typeof expressValue === "string") return expressValue;
  }

  const value = req.headers?.[name.toLowerCase()];
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
}

function installedExtensionBaseUrl(config: ConfigReader, req: Request): string {
  const webtaskUrl = (req as WebtaskRequest).x_wt?.ectx?.PUBLIC_WT_URL;
  if (typeof webtaskUrl === "string" && webtaskUrl) return webtaskUrl.replace(/\/$/, "");

  const configuredWebtaskUrl = readConfig(config, "PUBLIC_WT_URL");
  if (configuredWebtaskUrl) return configuredWebtaskUrl.replace(/\/$/, "");

  const protocol = requestHeader(req, "x-forwarded-proto") ?? req.protocol ?? "https";
  const host = requestHeader(req, "x-forwarded-host") ?? requestHeader(req, "host");
  if (!host) throw new Error("Unable to determine the installed Webtask URL.");

  const pathname = (req.originalUrl ?? req.url ?? "/").split("?", 1)[0];
  const routeSuffix = [
    "/.well-known/oauth-protected-resource/mcp",
    "/mcp",
    "/health",
    "/setup/provision",
  ].find((suffix) => pathname.endsWith(suffix));
  const basePath = routeSuffix ? pathname.slice(0, -routeSuffix.length) : pathname === "/" ? "" : pathname;
  return `${protocol}://${host}${basePath}`;
}

function publicMcpBaseUrl(config: ConfigReader, req: Request): string {
  const override = readConfig(config, "PUBLIC_BASE_URL");
  return override ? override.replace(/\/$/, "") : installedExtensionBaseUrl(config, req);
}

function mcpUrl(config: ConfigReader, req: Request): string {
  return `${publicMcpBaseUrl(config, req)}/mcp`;
}

function protectedResourceMetadataUrl(config: ConfigReader, req: Request): string {
  const endpoint = new URL(mcpUrl(config, req));
  return `${endpoint.origin}${protectedResourceMetadataPath}${endpoint.pathname}`;
}

function setupAdminAuth(config: ConfigReader, req: Request): SetupAdminAuth | undefined {
  const extensionSecret = readConfig(config, "EXTENSION_SECRET");
  const domain = readConfig(config, "AUTH0_DOMAIN");
  if (!extensionSecret || !domain) return undefined;

  const extensionTools = require("auth0-extension-express-tools") as LegacyExtensionTools;
  const baseUrl = installedExtensionBaseUrl(config, req);
  const options = {
    audience: setupAudience,
    baseUrl,
    clientName: "Auth0 Who Am I MCP",
    domain: toAuth0Domain(domain),
    noAccessToken: true,
    rta: toAuth0Domain(readConfig(config, "AUTH0_RTA") ?? domain),
    scopes: "read:resource_servers create:resource_servers",
    secret: extensionSecret,
    sessionStorageKey: setupSessionStorageKey,
    urlPrefix: setupAdminPath,
  };

  return {
    authenticate: extensionTools.middlewares.authenticateAdmins({
      audience: options.audience,
      baseUrl: options.baseUrl,
      secret: options.secret,
    }),
    routes: extensionTools.routes.dashboardAdmins(options),
  };
}

function managementCredentials(config: ConfigReader) {
  const domain = readConfig(config, "AUTH0_DOMAIN");
  const clientId = readConfig(config, "AUTH0_CLIENT_ID");
  const clientSecret = readConfig(config, "AUTH0_CLIENT_SECRET");
  if (!domain || !clientId || !clientSecret) {
    throw new Error("The extension management client is unavailable. Update or reinstall the extension before provisioning its API.");
  }

  return { clientId, clientSecret, domain: toAuth0Domain(domain) };
}

async function managementAccessToken(config: ConfigReader): Promise<{ domain: string; token: string }> {
  const credentials = managementCredentials(config);
  const response = await fetch(`https://${credentials.domain}/oauth/token`, {
    body: JSON.stringify({
      audience: `https://${credentials.domain}/api/v2/`,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Unable to obtain a Management API token (${response.status}).`);

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || !payload.access_token) {
    throw new Error("The Management API token response did not contain an access token.");
  }

  return { domain: credentials.domain, token: payload.access_token };
}

async function managementApiJson<T>(
  domain: string,
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://${domain}/api/v2/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new ManagementApiError(`Management API request failed (${response.status}).`, response.status);
  return (await response.json()) as T;
}

async function listResourceServers(domain: string, token: string): Promise<ResourceServer[]> {
  const resourceServers: ResourceServer[] = [];
  const perPage = 100;

  for (let page = 0; page < 20; page += 1) {
    const result = await managementApiJson<unknown>(domain, token, `resource-servers?page=${page}&per_page=${perPage}`);
    const currentPage = Array.isArray(result)
      ? result
      : Array.isArray((result as { resource_servers?: unknown[] }).resource_servers)
        ? (result as { resource_servers: unknown[] }).resource_servers
        : [];
    const validResources = currentPage.filter(
      (resource): resource is ResourceServer =>
        typeof resource === "object" &&
        resource !== null &&
        typeof (resource as ResourceServer).id === "string" &&
        typeof (resource as ResourceServer).identifier === "string",
    );
    resourceServers.push(...validResources);
    if (currentPage.length < perPage) break;
  }

  return resourceServers;
}

async function ensureResourceServer(config: ConfigReader, audience: string) {
  const { domain, token } = await managementAccessToken(config);
  const existing = (await listResourceServers(domain, token)).find((resource) => resource.identifier === audience);
  if (existing) return { audience, resourceServerId: existing.id, status: "reused" as const };

  try {
    const created = await managementApiJson<ResourceServer>(domain, token, "resource-servers", {
      body: JSON.stringify({
        identifier: audience,
        name: "Auth0 Who Am I MCP",
        scopes: [],
        signing_alg: "RS256",
      }),
      method: "POST",
    });
    return { audience, resourceServerId: created.id, status: "created" as const };
  } catch (error) {
    if (!(error instanceof ManagementApiError) || error.status !== 409) throw error;
    const concurrentResource = (await listResourceServers(domain, token)).find(
      (resource) => resource.identifier === audience,
    );
    if (!concurrentResource) throw error;
    return { audience, resourceServerId: concurrentResource.id, status: "reused" as const };
  }
}

function createAuth0Verifier(domain: string, audience: string): OAuthTokenVerifier {
  const client = new ApiClient({ domain: toAuth0Domain(domain), audience });

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let claims;
      try {
        claims = await client.verifyAccessToken({ accessToken: token });
      } catch {
        throw new InvalidTokenError("invalid access token");
      }

      const sub = typeof claims.sub === "string" ? claims.sub : undefined;
      if (!sub) throw new InvalidTokenError("access token has no sub claim");

      const clientId =
        typeof claims.azp === "string"
          ? claims.azp
          : typeof claims.aud === "string"
            ? claims.aud
            : Array.isArray(claims.aud)
              ? claims.aud.find((audience): audience is string => typeof audience === "string") ?? ""
              : "";
      const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
      const permissions = Array.isArray(claims.permissions)
        ? claims.permissions.filter((permission): permission is string => typeof permission === "string")
        : [];

      return {
        token,
        clientId,
        scopes,
        expiresAt: typeof claims.exp === "number" ? claims.exp : undefined,
        extra: {
          sub,
          name: typeof claims.name === "string" ? claims.name : undefined,
          email: typeof claims.email === "string" ? claims.email : undefined,
          emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined,
          permissions,
        },
      };
    },
  };
}

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "auth0-whoami-mcp", version: "1.0.0" });
  server.registerTool(
    "whoami",
    { description: "Return safe identity claims for the authenticated Auth0 user." },
    async (extra) => {
      const authInfo = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo;
      const claims = authInfo?.extra as
        | {
            sub?: unknown;
            name?: unknown;
            email?: unknown;
            emailVerified?: unknown;
            permissions?: unknown;
          }
        | undefined;
      const result = {
        subject: typeof claims?.sub === "string" ? claims.sub : null,
        name: typeof claims?.name === "string" ? claims.name : null,
        email: typeof claims?.email === "string" ? claims.email : null,
        email_verified: typeof claims?.emailVerified === "boolean" ? claims.emailVerified : null,
        client_id: authInfo?.clientId ?? null,
        scopes: authInfo?.scopes ?? [],
        permissions: Array.isArray(claims?.permissions) ? claims.permissions : [],
      };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );
  return server;
}

function bearerAuth(config: ConfigReader, req: Request): RequestHandler {
  const issuer = `${tenantOrigin(config)}/`;
  return requireBearerAuth({
    verifier: createAuth0Verifier(issuer, mcpUrl(config, req)),
    resourceMetadataUrl: protectedResourceMetadataUrl(config, req),
  });
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function extensionRoutes(path: string): string[] {
  return [path, `/:extensionName${path}`];
}

const pageStyles = `
  :root { color-scheme: light; }
  body { margin: 0; padding: 2.5rem 1.5rem; background: #f6f5f4; color: #1a1523; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
  h2 { font-size: 1.1rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 0.75rem; }
  .lede { color: #635e6f; }
  code, .code-block { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85em; }
  code { background: #ece9e6; padding: 0.15em 0.4em; border-radius: 4px; word-break: break-all; }
  .card { background: #fff; border: 1px solid #e4e1e8; border-radius: 10px; padding: 1.5rem; margin-top: 1.5rem; }
  .card.success { border-color: #b6e3c6; background: #f2fbf5; }
  .button { display: inline-block; background: #1a1523; color: #fff; text-decoration: none; padding: 0.55em 1.1em; border-radius: 6px; font-weight: 600; }
  .button:hover { background: #362f45; }
  .status { color: #635e6f; font-size: 0.9em; }
  .status.error { color: #b3261e; }
  .code-block { display: block; background: #1a1523; color: #f6f5f4; padding: 0.9rem 1rem; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .steps { padding-left: 1.25rem; }
  .steps li { margin-bottom: 0.5rem; }
  a { color: #4c1d95; }
`;

function renderSetupSection(options: { endpoint: string; setupBaseUrl: string }): string {
  const loginHref = `${options.setupBaseUrl}${setupAdminPath}/login`;
  const config = escapeInlineJson({ endpoint: `${options.setupBaseUrl}/setup/provision`, storageKey: setupSessionStorageKey });
  return `
    <section class="card" id="setup-card">
      <h2>1. Provision the Auth0 API</h2>
      <p class="lede">Sign in as a tenant administrator to create or reuse the Auth0 API resource server for this MCP endpoint.</p>
      <p><a id="setup-login" class="button" href="${escapeHtml(loginHref)}">Sign in and provision</a></p>
      <p id="setup-status" class="status"></p>
    </section>
    <section class="card" id="next-steps-card" hidden>
      <h2>2. Install the OAuth discovery extension</h2>
      <p class="lede">MCP clients discover this endpoint's authorization server through a separate <code>.well-known</code> Custom Extension. It must be installed once per tenant.</p>
      <ol class="steps">
        <li>In this tenant's Dashboard, go to <strong>Extensions</strong> and install <a href="https://github.com/mustafadeel/auth0-ext-wellknown" target="_blank" rel="noopener">auth0-ext-wellknown</a> (keep its name <code>.well-known</code>).</li>
        <li>Open the installed <code>.well-known</code> extension's settings and set:</li>
      </ol>
      <code class="code-block" id="wellknown-config"></code>
      <p class="lede">Once configured, connect an OAuth-capable MCP client to the endpoint below.</p>
      <code id="mcp-endpoint">${escapeHtml(options.endpoint)}</code>
    </section>
    <script>
      const setup = ${config};
      const statusEl = document.getElementById("setup-status");
      const token = sessionStorage.getItem(setup.storageKey);
      if (token) {
        statusEl.textContent = "Provisioning the Auth0 API resource server…";
        fetch(setup.endpoint, { method: "POST", headers: { Authorization: "Bearer " + token } })
          .then(async (response) => ({ ok: response.ok, body: await response.json() }))
          .then((result) => {
            if (!result.ok) throw new Error(result.body.message || "Setup failed.");
            document.getElementById("setup-card").classList.add("success");
            statusEl.textContent = "Resource server " + result.body.status + ": " + result.body.audience;
            document.getElementById("setup-login").remove();
            const nextSteps = document.getElementById("next-steps-card");
            nextSteps.hidden = false;
            document.getElementById("wellknown-config").textContent =
              "MCP_RESOURCE_URL=" + result.body.audience + "\\nAUTH0_TENANT_ORIGIN=" + result.body.issuer;
          })
          .catch((error) => {
            statusEl.classList.add("error");
            statusEl.textContent = "Setup failed: " + error.message;
          });
      } else {
        statusEl.textContent = "Not signed in yet.";
      }
    </script>
  `;
}

function renderPage(options: { endpoint: string; setup: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Auth0 Who Am I MCP</title>
  <style>${pageStyles}</style>
</head>
<body>
  <main>
    <h1>Auth0 Who Am I MCP</h1>
    <p class="lede">This Custom Extension exposes an authenticated MCP endpoint.</p>
    <p><code>${escapeHtml(options.endpoint)}</code></p>
    ${options.setup}
  </main>
</body>
</html>`;
}

export function createExtensionApp(configReader: ConfigReader, initialRequest?: Request) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const setupAuth = initialRequest ? setupAdminAuth(configReader, initialRequest) : undefined;
  if (setupAuth) {
    app.use(setupAuth.routes);
    app.use("/:extensionName", setupAuth.routes);
  }

  app.get(extensionRoutes("/"), (req, res) => {
    const endpoint = mcpUrl(configReader, req);
    const setupBaseUrl = installedExtensionBaseUrl(configReader, req);
    const setup = setupAuth
      ? renderSetupSection({ endpoint, setupBaseUrl })
      : `<section class="card"><h2>Tenant setup unavailable</h2><p>Update or reinstall this extension so Auth0 can provision its managed setup client.</p></section>`;
    res.type("html").send(renderPage({ endpoint, setup }));
  });

  app.get(extensionRoutes("/health"), (_req, res) => {
    res.status(200).json({ status: "ok", runtime: process.version });
  });

  app.get(
    [
      ...extensionRoutes(protectedResourceMetadataPath),
      ...extensionRoutes(`${protectedResourceMetadataPath}/mcp`),
    ],
    (req, res, next) => {
      try {
        const issuer = `${tenantOrigin(configReader)}/`;
        const metadata = new ProtectedResourceMetadataBuilder(mcpUrl(configReader, req), [issuer])
          .withResourceName("Auth0 Who Am I MCP")
          .build();
        return res.json(metadata);
      } catch (error) {
        return next(error);
      }
    },
  );

  if (setupAuth) {
    app.post(extensionRoutes("/setup/provision"), setupAuth.authenticate, async (req, res, next) => {
      try {
        const provisioned = await ensureResourceServer(configReader, mcpUrl(configReader, req));
        return res.status(200).json({
          audience: provisioned.audience,
          issuer: tenantOrigin(configReader),
          resourceServerId: provisioned.resourceServerId,
          status: provisioned.status,
        });
      } catch (error) {
        return next(error);
      }
    });
  }

  app.all(extensionRoutes("/mcp"), async (req, res, next) => {
    try {
      const authentication = bearerAuth(configReader, req);
      authentication(req, res, () => {
        void handleMcpRequest(req, res).catch(next);
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: unknown) => {
    const candidateStatus =
      typeof error === "object" && error !== null
        ? (error as { status?: unknown; statusCode?: unknown }).status ??
          (error as { statusCode?: unknown }).statusCode
        : undefined;
    const status =
      typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus <= 599
        ? candidateStatus
        : 500;
    const message = status < 500 && error instanceof Error ? error.message : "Internal Server Error";
    if (status >= 500) {
      console.error("[auth0-whoami-mcp] request failed", error);
    } else {
      console.warn(`[auth0-whoami-mcp] request rejected (${status})`);
    }
    if (!res.headersSent) res.status(status).json({ error: status < 500 ? "request_failed" : "internal_error", message });
  });

  return app;
}
