# Auth0 Who Am I MCP Template

Fork this public template to create an Auth0 Custom Extension that exposes an authenticated Streamable HTTP MCP server. Its `whoami` tool returns safe claims for the current Auth0 user.

**Forking is required, not optional** — the legacy Custom Extension importer reads `webtask.json` and generated build artifacts directly from a specific GitHub repo URL at both preview and install time, so there is no way to install a shared/parameterized copy of this template. Forking means taking on the whole deployment contract below: generated build output (`index.js`, `build/bundle.js`, `dist/`) is committed to git rather than gitignored, `main` and `master` must be kept in sync by hand, and the fork must stay public. This is more upkeep than a typical npm-installed dependency; budget for it before adopting this template.

The template targets Node 22, derives the tenant issuer and installed MCP URL at runtime, and creates or reuses the Auth0 API resource server from a tenant-admin setup flow. It does not ask users to enter tenant or direct MCP URLs in extension settings.

See `SKILL.md` for the full manifest layout, route table, and a troubleshooting section covering every non-obvious failure mode hit while building this template — check there first if something that used to work stops working.

## Fork and customize

1. Fork this repository and keep the fork **public**.
2. Update `webtask.json` and `package.json` with your title, extension name, author, repository URL, and version.
3. Add or replace tools in `src/mcp-server.ts` (see **Add a tool** below). Everything else in `src/app.ts` — bearer-token verification, the setup routes, `.well-known` metadata — is deployment plumbing shared by every tool; leave it intact.
4. Run `npm install` and `npm test` with your organization's managed npm authentication.
5. Commit generated `index.js`, `build/bundle.js`, `dist/extension.js`, `dist/package.json`, and `dist/package.zip`.
6. Push the same release to both `main` and `master`. The legacy Custom Extension importer fetches generated loader files from `master`. After merging any change into `main`, fast-forward `master` to match (`git checkout master && git merge --ff-only origin/main && git push origin master`) — the two branches drifting apart is a common source of confusing, hard-to-reproduce bugs.

## Add a tool

Tools live in `src/mcp-server.ts`, registered on the `McpServer` instance inside `createMcpServer()`. Add a new `server.registerTool(...)` call there:

```ts
server.registerTool(
  "my_tool",
  { description: "What this tool does." },
  async (extra) => {
    const authInfo = (extra as { authInfo?: AuthInfo } | undefined)?.authInfo;
    const userId = (authInfo?.extra as { sub?: unknown } | undefined)?.sub;
    // ... your tool logic, using userId or authInfo.scopes as needed ...
    return { content: [{ type: "text", text: JSON.stringify({ result: "..." }) }] };
  },
);
```

The `authInfo` object is the already-verified caller identity — `authInfo.extra.sub` is the Auth0 user ID, `authInfo.scopes` is the token's granted scopes, `authInfo.clientId` is the calling application. Only `sub` is guaranteed present on every access token; other OIDC claims (`name`, `email`, etc.) are ID token claims and won't appear here unless a Post-Login Action explicitly copies them into the access token.

If a tool needs to call the Auth0 Management API (beyond what the setup flow already does), add the required scope to `auth0.scopes` in both `webtask.json` and `package.json`, then follow **Deploy to Auth0** below — a scopes change requires a full reinstall/update.

## Deploy to Auth0

1. Perform a full Custom Extension import or update from this public repository. Do not use a code-only redeploy when the manifest changes.
2. Open the installed extension and select **Sign in and provision**.
3. Complete the Dashboard-admin login. The extension creates or reuses an `RS256` Auth0 API resource server whose identifier is the displayed MCP URL.
4. Import `https://github.com/mustafadeel/auth0-ext-wellknown` as a separate Custom Extension in the same tenant. Keep its name `.well-known` and `useHashName: false`. It requires no configuration — it derives the MCP resource URL and tenant issuer from each request automatically.
5. On the same setup page, promote a connection to domain-level if none is promoted yet. Third-party and dynamically registered MCP clients can only authenticate through a domain-level connection.
6. Register the MCP client: if Dynamic Client Registration is enabled for the tenant most clients register themselves, otherwise follow the manual application setup shown on the setup page.
7. Connect Claude, Codex, or MCP Inspector to the displayed `/mcp` URL and complete OAuth.

The public MCP, health, meta, and metadata routes never change tenant configuration. Only the Dashboard-admin-protected setup routes can provision the resource server and list/promote connections. `GET /meta` serves `webtask.json`'s contents verbatim and is unauthenticated by design, matching the equivalent route in other Auth0 extensions.

## Optional external public endpoint

The default audience is the installed Webtask URL plus `/mcp`. If you intentionally put an external proxy or custom domain in front of the MCP server, add an optional `PUBLIC_BASE_URL` setting to `webtask.json` and set it to the proxy origin. The resource-server identifier becomes `${PUBLIC_BASE_URL}/mcp`.

## Local checks

```sh
npm install
npm test
```

The smoke test invokes the compiled bundle directly with a simulated Webtask request, verifying the landing page, `/meta`, and the admin-login route are present, and that every setup-admin route rejects unauthenticated requests. The build step additionally validates the packaged `dist/package.json` against Auth0's real extension schema.
