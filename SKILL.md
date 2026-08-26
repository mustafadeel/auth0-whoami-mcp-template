---
name: auth0-whoami-mcp-template
description: Fork, customize, deploy, or troubleshoot the Auth0 Who Am I MCP template as an Auth0 Custom Extension. Use when adapting this repository's MCP tools, publishing its generated Webtask artifacts, provisioning its Auth0 API resource server, promoting a domain-level connection, registering an MCP client, or connecting an OAuth-capable MCP client.
---

# Auth0 Who Am I MCP Template

A public, forkable starting point for an Auth0-hosted Streamable HTTP MCP server, packaged as a legacy Custom Extension (Webtask). The `whoami` tool is intentionally small; retain its deployment and authorization contract while replacing tools.

**Fork this repository rather than depending on it directly.** The legacy Custom Extension importer reads `webtask.json` and generated build artifacts from a specific GitHub repo URL at both preview and install time — there is no parameterized/shared-install path. Forking means owning the full deployment contract described here: committed build output, hand-synced `main`/`master`, a public repo requirement, and every item in **Troubleshooting**. This is not a from-scratch integration, but it is also not a drop-in dependency — treat it like vendoring a codebase you'll maintain, not installing a package.

Custom Extensions are an older, largely undocumented Auth0 feature, and several of its behaviors are non-obvious or actively misleading (see **Troubleshooting** below). Follow this skill closely rather than improvising around it.

## Customize

1. Keep the fork public and update repository metadata in both `webtask.json` and `package.json`'s `auth0-extension` block. Keep both in sync — they describe the same extension from two different places (see **Manifest shape**, below).
2. Retain `useHashName: false` and `auth0.createClient: true`.
3. Add tools in `src/mcp-server.ts`'s `createMcpServer()` (see **Add a tool** below); use the authenticated `AuthInfo` supplied by MCP middleware rather than parsing raw headers. `src/app.ts` is deployment plumbing (bearer-token verification, setup routes, `.well-known` metadata) shared by every tool — leave it alone unless the plumbing itself needs to change.
4. If a new tool needs more Management API access, add scopes to `auth0.scopes` in **both** `webtask.json` and `package.json`. A scopes change requires a full reinstall/update (see **Provision and deploy**).
5. Do not add required settings for tenant origin, direct MCP URL, or resource metadata URL. The template derives them from `AUTH0_DOMAIN` and trusted Webtask runtime context.
6. Keep `PUBLIC_BASE_URL` only as an optional explicit override for an external proxy or custom domain.

## Add a tool

Tools are registered on the `McpServer` instance inside `createMcpServer()` in `src/mcp-server.ts` — this file is intentionally kept free of the Management API/setup-flow plumbing in `src/app.ts`, so it's the one file a fork's own tools should live in.

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

`authInfo` is the already bearer-token-verified caller identity, supplied by `bearerAuth()`/`createAuth0Verifier()` in `src/app.ts` before the request ever reaches a tool — never parse `Authorization` headers directly inside a tool. `authInfo.extra.sub` (the Auth0 user ID) is the only claim guaranteed present; `authInfo.scopes` and `authInfo.clientId` come straight from the verified access token. Other OIDC claims (`name`, `email`, `email_verified`) are ID token claims, not access token claims — they will be `undefined` here unless a tenant's Post-Login Action explicitly copies them into the access token.

## Manifest shape

Two files describe the extension, and only one of them is what Auth0 actually deploys:

- `webtask.json` (repo root) is fetched raw from GitHub (`raw.githubusercontent.com/.../webtask.json`) when you paste the repo URL into the Dashboard's "Create Extension" flow — it drives the initial import preview. It is a flat manifest: `title`, `type`, `useHashName`, `initialUrlPath`, `auth0`, etc. all live at the top level, alongside `name`/`version`/`author`. It is also served live at `GET /meta` (see **Routes**, below).
- `package.json`'s `auth0-extension` object is what `scripts/create-extension-package.mjs` copies into `dist/package.json`, which is what actually ships inside `dist/package.zip` and gets installed. This nested shape (`auth0-extension: { title, type, ... }`) is validated against Auth0's real schema (`webtask-json-validator` on npm, the same package the official `a0-ext` CLI uses) as part of `npm run build`.

Keep both manifests' `auth0.scopes`, `title`, `logoUrl`, etc. in sync by hand — nothing enforces this automatically beyond `scripts/validate-manifest.mjs`'s narrower checks on `webtask.json` alone.

`webtask.json`'s top-level `runtime: "node22"` field is required — do not remove it, even though it is not part of `package.json`'s `auth0-extension` schema.

## Provision and deploy

1. Build: `npm install && npm test`.
2. Commit `index.js`, `build/bundle.js`, `dist/extension.js`, `dist/package.json`, and `dist/package.zip`.
3. Push matching generated artifacts and manifest version to both `main` and `master`; the legacy importer reads `master`. After merging any PR to `main`, fast-forward `master` to match:
   ```sh
   git checkout master && git merge --ff-only origin/main && git push origin master
   ```
   `main` and `master` drifting out of sync is a common, easy-to-miss failure mode — always re-check `git ls-remote origin` shows the same SHA for both after any change.
4. Import or fully update the Custom Extension from the Dashboard's Extensions page. **A manifest change (new scopes, title, logo, anything under `auth0-extension`) requires a full update/reinstall, not a code-only redeploy** — Auth0 only re-reads the manifest and re-provisions the managed client on install/update, not on every request.
5. Open the landing page (the extension's tile, or the installed URL directly) and complete **Sign in and provision** (step 1 on the page). This protected route obtains an extension-owned Management API token and: creates or reuses the API resource server whose identifier is the exact MCP audience; creates or reuses a client grant on that resource server with `default_for: "third_party_clients"`, `allow_all_scopes: true`, `subject_type: "user"` (without this, a DCR-registered or otherwise not-pre-authorized client has no scope grant to request against the API at all); and sets the tenant's `resource_parameter_profile` to `"compatibility"` if it isn't already, since third-party/DCR clients depend on it.
6. Step 2 on the same page: install `https://github.com/mustafadeel/auth0-ext-wellknown` as a separate Custom Extension in the same tenant (name `.well-known`, `useHashName: false`). It requires no configuration — it derives the MCP resource URL and tenant issuer from each request automatically.
7. Step 3: promote a connection to domain-level if none is promoted yet. Third-party and dynamically registered MCP clients can only authenticate through a domain-level connection — without one they have no way to show a login screen at all. This is a hard requirement for Dynamic Client Registration specifically, since DCR-created clients can't be individually mapped to a connection at creation time.
8. Step 4: check the displayed Dynamic Client Registration and Client ID Metadata Document (CIMD) status. If either is disabled, an **Enable** button on the page flips it on directly (`PATCH tenants/settings`); be aware enabling DCR means anyone who discovers the endpoint can self-register a client against the tenant — disable it again under Dashboard → Settings → Advanced if that's not intended. If you'd rather not enable DCR/CIMD at all, register the client manually per the on-page instructions (grant types, callback URL, audience).
9. Connect an OAuth-capable MCP client (Claude, Codex, MCP Inspector) to the displayed `/mcp` URL and complete OAuth.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | public | Landing page; renders the four-step setup flow described above |
| `GET /health` | public | `{ status, runtime }` liveness check |
| `GET /meta` | public | Serves `webtask.json`'s contents verbatim |
| `GET /.well-known/oauth-protected-resource(/*)` | public | RFC 9728 protected-resource metadata for this MCP endpoint |
| `POST /setup/provision` | Dashboard-admin session | Creates/reuses the resource server, its third-party client grant, and corrects `resource_parameter_profile` |
| `GET /setup/status` | Dashboard-admin session | Lists connections and DCR/CIMD status for steps 3–4 |
| `POST /setup/connections/:id/promote` | Dashboard-admin session | Sets `is_domain_connection: true` |
| `POST /setup/dcr/enable` | Dashboard-admin session | Sets `flags.enable_dynamic_client_registration: true` |
| `POST /setup/cimd/enable` | Dashboard-admin session | Sets `client_id_metadata_document_supported: true` |
| `ALL /mcp` | bearer token | The MCP server itself |

Every route is registered twice via `extensionRoutes(path)`, which returns `[path, "/:extensionName" + path]` — Webtask strips the extension's own name prefix from `req.url` before Express sees the request (wildcard-domain installs), but the un-stripped `/:extensionName/...` form stays reachable as a fallback for other URL formats. **Route registration order matters**: Express's trailing-slash-optional matching means `/:extensionName/` (the landing route's pattern) will shadow any other single-segment route registered before it — this bit `/health` and `/meta` in the past. The landing route (`GET /`) must be registered last, after every other route.

## Local checks

```sh
npm install
npm test
```

`npm test` runs `typecheck && build && smoke`. The build step validates `webtask.json` (`scripts/validate-manifest.mjs`) and, separately, validates the packaged `dist/package.json` against Auth0's real extension schema (inside `scripts/create-extension-package.mjs`) — a build failure here means the Dashboard would silently receive a broken or incomplete manifest.

The smoke test (`scripts/smoke.mjs`) invokes the compiled bundle directly with a simulated Webtask request (`req.x_wt` set to a wildcard-domain claims object), not a real HTTP server — this is what actually exercises the `webtask-tools` URL-normalization path the real runtime performs, which a plain Express request would not. It checks the landing page, `/meta`, `/health`, the admin-login redirect, and that every setup-admin route rejects unauthenticated requests.

## Troubleshooting

These are real, previously-hit failure modes — check here before re-diagnosing from scratch.

- **Dashboard tile does nothing when clicked.** Two independent causes have been found and fixed here; if this recurs, suspect a third. (1) The webtask handler must be wrapped with `webtask-tools`' `fromExpress`/`fromConnect` — without it, `req.url` still carries the Webtask routing prefix and Express never matches any route. (2) The compiled bundle must export a bare function (`export = handler` in `src/webtask.ts`, not a named export) — Webtask requires "the supplied code must return or export a function"; an object export fails with `Invalid webtask code`.
- **`dist/package.json` looks fine locally but the Dashboard renders an incomplete/broken tile (no logo, wrong title, etc).** Check `scripts/create-extension-package.mjs` actually copies `package.json`'s full `auth0-extension` object into the runtime package — it's easy to write a version that only copies `name`/`version`/`main`/`engines` and silently drops everything the Dashboard needs to render the extension correctly. Validate against `webtask-json-validator` (already wired into the build) to catch this class of bug before it ships.
- **`"Login failed. Invalid token."` on the setup OAuth callback**, despite a valid login. The callback (`/.extensions/setup/login/callback`) receives an `application/x-www-form-urlencoded` POST (Auth0's `response_mode=form_post`). If only `express.json()` is registered, `req.body` stays empty for this request and the callback always sees `id_token` as `undefined`. Register `express.urlencoded({ extended: false })` alongside `express.json()`.
- **`/.well-known/oauth-protected-resource` 404s on the companion extension.** The `.well-known` extension's own name gets stripped from `req.url` by `webtask-tools` before its handler runs, so a request to `/.well-known/oauth-protected-resource/...` arrives at the handler as `/oauth-protected-resource/...` — code that still matches against paths including the `/.well-known` prefix will never match. The companion extension (`auth0-ext-wellknown`) requires no configuration as of its zero-config bootstrap — it derives everything from `AUTH0_DOMAIN` and the request path itself; only the resource-suffixed path is served (the bare, unsuffixed path is an intentional 404, since it can't be disambiguated to a specific MCP extension without configuration).
- **A single-segment route (e.g. `/health`, `/meta`) always returns the landing page instead of its own response.** See **Routes** above — the landing route must be registered last, after every other route.
- **`webtask.json` fails to validate against `webtask-json-validator`** with `secrets should NOT have fewer than 1 properties`. `secrets: {}` is invalid; omit the field entirely if there are no configurable settings, rather than declaring an empty object.
- **A field you added to `package.json`'s `auth0-extension` silently has no effect on the packaged `dist/package.json`.** `additionalProperties: false` on that schema (`webtask-json-validator`) means only a fixed set of fields are recognized there (`title`, `category`, `type`, `useHashName`, `nodeTarget`, `bundleModules`, `settings`, `codeUrl`, `docsUrl`, `logoUrl`, `initialUrlPath`, `uninstallConfirmMessage`, `updateConfirmMessage`, `schedule`, `auth0`, `secrets`, `externals`, `excluded`). This schema does not govern `webtask.json` at the repo root — that file has its own, separate field set (see **Manifest shape** above).

## Guardrails

- `auth0.createClient` creates credentials only; the protected setup route must create or reuse the resource server.
- Never run tenant mutations from public MCP, health, meta, discovery, or OAuth callback routes.
- Do not expose or log `AUTH0_CLIENT_SECRET`, `EXTENSION_SECRET`, access tokens, or Authorization headers.
- Validate bearer tokens against the exact computed MCP audience and Auth0 issuer.
- Keep both extension repositories public; legacy import does not supply GitHub credentials.
- Never change scope or behavior beyond what was explicitly requested for a given change — Custom Extension manifests are easy to over-edit "while you're in there," and unrequested changes here have broken working deployments more than once.
