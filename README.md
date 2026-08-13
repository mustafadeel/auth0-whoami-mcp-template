# Auth0 Who Am I MCP Template

Fork this public template to create an Auth0 Custom Extension that exposes an authenticated Streamable HTTP MCP server. Its `whoami` tool returns safe claims for the current Auth0 user.

The template targets Node 22, derives the tenant issuer and installed MCP URL at runtime, and creates or reuses the Auth0 API resource server from a tenant-admin setup flow. It does not ask users to enter tenant or direct MCP URLs in extension settings.

## Fork and customize

1. Fork this repository and keep the fork **public**.
2. Update `webtask.json` and `package.json` with your title, extension name, author, repository URL, and version.
3. Replace or add tools in `src/app.ts`. Keep the bearer-token verification and protected setup route intact.
4. Run `npm install` and `npm test` with your organization's managed npm authentication.
5. Commit generated `index.js`, `build/bundle.js`, `dist/extension.js`, and `dist/package.zip`.
6. Push the same release to both `main` and `master`. The legacy Custom Extension importer fetches generated loader files from `master`.

## Deploy to Auth0

1. Perform a full Custom Extension import or update from this public repository. Do not use a code-only redeploy when the manifest changes.
2. Open the installed extension and select **Sign in and provision**.
3. Complete the Dashboard-admin login. The extension creates or reuses an `RS256` Auth0 API resource server whose identifier is the displayed MCP URL.
4. Import `https://github.com/mustafadeel/auth0-ext-wellknown` as a separate Custom Extension in the same tenant. Keep its name `.well-known` and `useHashName: false`.
5. Configure the companion with the MCP URL displayed by this extension and the tenant issuer displayed by setup.
6. Connect Claude, Codex, or MCP Inspector to the displayed `/mcp` URL and complete OAuth.

The public MCP, health, and metadata routes never change tenant configuration. Only the Dashboard-admin-protected setup route can provision the resource server.

## Optional external public endpoint

The default audience is the installed Webtask URL plus `/mcp`. If you intentionally put an external proxy or custom domain in front of the MCP server, add an optional `PUBLIC_BASE_URL` setting to `webtask.json` and set it to the proxy origin. The resource-server identifier becomes `${PUBLIC_BASE_URL}/mcp`.

## Local checks

```sh
npm install
npm test
```

The smoke test verifies that the landing page and admin-login route are present and that unauthenticated provisioning is rejected.
