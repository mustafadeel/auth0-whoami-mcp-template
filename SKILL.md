---
name: auth0-whoami-mcp-template
description: Fork, customize, deploy, or troubleshoot the Auth0 Who Am I MCP template as a Node 22 Auth0 Custom Extension. Use when adapting this repository's MCP tools, publishing its generated Webtask artifacts, provisioning its Auth0 API resource server, or connecting an OAuth-capable MCP client.
---

# Auth0 Who Am I MCP Template

Use this repository as a public forkable starting point for an Auth0-hosted Streamable HTTP MCP server. The `whoami` tool is intentionally small; retain its deployment and authorization contract while replacing tools.

## Customize

1. Keep the fork public and update repository metadata in both `webtask.json` and `package.json`.
2. Retain the complete `webtask.json` schema, Node 22 runtime, `useHashName: false`, and `auth0.createClient` Management API scopes.
3. Add tools in `src/app.ts`; use the authenticated `AuthInfo` supplied by MCP middleware rather than parsing raw headers.
4. Do not add required settings for tenant origin, direct MCP URL, or resource metadata URL. The template derives them from `AUTH0_DOMAIN` and trusted Webtask runtime context.
5. Keep `PUBLIC_BASE_URL` only as an optional explicit override for an external proxy or custom domain.

## Provision and deploy

1. Build with Node 22: `npm install && npm test`.
2. Commit `index.js`, `build/bundle.js`, `dist/extension.js`, and `dist/package.zip`.
3. Push matching generated artifacts and manifest version to both `main` and `master`; the legacy importer reads `master`.
4. Import or fully update the Custom Extension. A manifest change requires a full update/reinstall so Auth0 provisions its managed client.
5. Open the landing page and complete **Sign in and provision**. This protected route obtains an extension-owned Management API token and creates or reuses the API resource server whose identifier is the exact MCP audience.
6. Configure the separate `.well-known` companion Custom Extension with the displayed MCP URL and tenant issuer. The main extension cannot edit another extension's settings.
7. On the same setup page, promote a connection to domain-level if none is promoted yet. Third-party and dynamically registered MCP clients can only authenticate through a domain-level connection; without one they have no way to show a login screen.
8. Check the displayed Dynamic Client Registration status. If disabled, register the MCP client manually per the on-page instructions; if enabled, be aware that any client can self-register against the tenant.

## Guardrails

- `auth0.createClient` creates credentials only; the protected setup route must create or reuse the resource server.
- Never run tenant mutations from public MCP, health, discovery, or OAuth callback routes.
- Do not expose or log `AUTH0_CLIENT_SECRET`, `EXTENSION_SECRET`, access tokens, or Authorization headers.
- Validate bearer tokens against the exact computed MCP audience and Auth0 issuer.
- Keep both extension repositories public; legacy import does not supply GitHub credentials.
