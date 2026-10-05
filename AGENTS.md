# file-host

file-host is a small Cloudflare Worker that gives coding agents a permanent public URL for files. An agent uploads a screenshot, recording, or report with one `curl` command, gets the URL back as the response body, and pastes it into a pull request.

You can think of file-host as a self-hosted, single-purpose alternative to dragging files into the GitHub comment box: it works from a terminal, needs no browser, and the URL never changes.

## What makes file-host special?

The Worker is small on purpose. Its value is a contract that agents can follow without thinking, and storage that browsers can trust. Here's a brief list of the things we can never compromise on.

### 1. Open at the core

The repository is public, and every uploaded file is public. Work as if everything you write here will be read by strangers, because it will. Never commit a token, a `.dev.vars` file, a production log, or anything that identifies a private project. The README is the public face of the project and should stay accurate.

### 2. Performance without compromise

Uploads stream straight from the request into R2 and are never buffered, so file size is not bound by the Worker's 128 MB memory limit. Keep it that way: do not read a request or object body into memory, and do not add per-request work that does not serve the request. Downloads support range and conditional requests so video seeking and browser caching work; do not break them.

### 3. Agent ready

Agents follow the instructions in the README's "For agents" section and in the `USAGE` text served at `GET /`. They treat the response body as the URL and react to specific status codes (401, 409, 413, 429). Changing the body format, a status code, or a header that agents rely on is a breaking change. Treat it as one, and update both copies of the instructions.

### 4. Multi-surface

file-host has 3 surfaces: **upload**, **download**, and **usage**.

**Upload** is `PUT /<filename>` with an `X-Upload-Token` header. It is the only authenticated path, and it is rate limited and size capped.

**Download** is `GET` and `HEAD` on `/<key>`, open to anyone. Files are opened by browsers, GitHub, and Slack, which decide how to render them from the `Content-Type` we serve. Every response carries the sandboxing and privacy headers set in `download()`.

**Usage** is `GET /`, a plain-text reminder of how to upload. It duplicates the README's agent instructions and must stay in sync with them.

## A note on approach

Prefer ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

Of note: Most file-host contributions come from coding agents running on the maintainer's machine. That machine holds the real `.dev.vars`, a logged-in Wrangler session that can deploy to production, and other dev servers. Be careful about reading secrets, deploying, killing processes, and other things that may damage the maintainer's setup or the live service.

## A small glossary

We need to be on the same page with terminology. When communicating, use this language:

- **you** means the agent reading this file and changing file-host.
- **we, us, and maintainers** mean Morgan, who builds and runs file-host. This is who you are talking to now.
- **uploader** means the agent or person holding the upload token and calling `PUT`.
- **agent** means a coding agent that uploads files through file-host. Depending on context, that may also include you.
- **viewer** means whoever opens a file URL: a browser, GitHub, Slack, or a person.
- **environment** means one place the Worker runs: local (`wrangler dev` or the Vitest pool, both backed by a local R2 simulation) or production (`file-host.vieira.tools`, backed by the real `file-host` bucket).
- **key** means an object's name in R2, built by `generateKey()` as `<slug>-<32 hex chars>[.ext]`. The key is also the URL path.
- **token** means the `UPLOAD_TOKEN` secret. It is at least 32 characters, compared in constant time, and never logged or committed.

## The three ways to hurt yourself

1. **Killing by pattern.** Never `Stop-Process -Name`, `taskkill /IM`, `pkill -f`, or kill a PID you found by matching a name, path, or worktree string. Your own agent process has this path in its command line, and this machine runs several other dev servers at once, many of them `node` or `workerd`. Kill only a PID you captured at spawn, or the owner of your port from `Get-NetTCPConnection -LocalPort <port>` after confirming the process is the one you started.
2. **Writing to production.** `npm run deploy`, `npx wrangler secret put`, `npx wrangler r2 object put` or `delete` against the `file-host` bucket, and `PUT` requests to `file-host.vieira.tools` all change the live service. Uploads are public and permanent, so a test upload cannot be taken back by the same path that made it. Reading production is fine. Never write to it unless the maintainer asks, and name what you are about to touch before touching it.
3. **Baking in origins.** Never hardcode `file-host.vieira.tools` into the URL `upload()` returns. The Worker builds that URL from the request's host, which is why tests can run against `https://files.test`. The domain belongs only in `wrangler.jsonc`, the README, and the `USAGE` text.

## Hit every surface

The most common defect in a project like this is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Entry points.** A behavior on `GET` usually also applies to `HEAD`, and `HEAD` must report the same headers and `Content-Length` without a body. `OPTIONS` and the 405 response both advertise `ALLOWED_METHODS`. Fixing one is not fixing the feature.
- **Clients.** Uploaders call `curl` from Bash and `curl.exe` from PowerShell, where plain `curl` is an alias for `Invoke-WebRequest`. Viewers are browsers, GitHub, and Slack, and they render by `Content-Type`.
- **Agents.** The README's "For agents" section and the `USAGE` constant in `src/index.ts` are the same instructions in two places. A change to how uploads work changes both.
- **Contracts.** The response body, status codes, and headers are the contract. Anything an agent reads must keep working for agents following last month's README.
- **Reverse states.** If you added a way in, add the way out and the way to see it. Here, uploads are deliberately one-way: URLs are immutable and there is no delete endpoint, so removing a file is a manual `wrangler r2 object delete` by the maintainer. Do not add a way to overwrite or delete through the API without asking.
- **Connection modes.** Local and production differ. Production is served only from the custom domain, because `workers_dev` and `preview_urls` are off in `wrangler.jsonc`. Rate limits apply per Cloudflare location.
- **Docs.** Check whether the change makes existing guidance inaccurate. Apply the [documentation rules](#documentation) before adding anything.

## Dev servers

- `npm install` installs. CI uses `npm ci`, so keep `package.json` and `package-lock.json` in sync.
- `npm run dev` starts `wrangler dev`. Copy `.dev.vars.example` to `.dev.vars` first; it holds a local-only token. Local R2 state lives in the gitignored `.wrangler/` directory, never in the real bucket.
- Wrangler prints the port it bound when it starts. Read the real one from that line rather than assuming the default, since another dev server may hold it.
- To try the Worker from another device, ask the maintainer instead of exposing a dev server.
- The local token in `.dev.vars` is separate from the production `UPLOAD_TOKEN`. Never commit `.dev.vars`, print the production token, or paste either into a commit message.
- Stop what you started, by the PID you tracked. See rule 1.

## Test data

An empty bucket is a bad test. Exercise the behavior against files that look like what agents upload:

- The Vitest suite runs inside the Workers runtime through `@cloudflare/vitest-plugin`, with a local R2 bucket and the test token set in `vitest.config.mts`. Upload through the Worker in the test, as `test/index.spec.ts` does with its `upload()` helper, rather than writing to R2 directly.
- Bring `.dev.vars` only if the flow under test needs a running `wrangler dev`.
- Data flows one way: never copy from the production bucket into tests, and never upload test data to production.

## Verifying

- Smallest proof that the change works first: `npx vitest run <file>` for the tests you touched, then `npm run lint` and `npm run typecheck`.
- Test meaningful logic or observable behavior. Assert on status codes, response bodies, and headers. Do not add tests that merely mirror the implementation.
- Run the full suite before handing work back: `npx vitest run`, `npm run format:check`, `npm run lint`, and `npm run typecheck`. The suite finishes in seconds. CI runs the same checks on every push.
- Behavior changes ship with focused tests for that behavior. For a bug fix, write the failing test first.
- Tests must be deterministic. Mock only what cannot be made deterministic, such as `crypto.getRandomValues` when a test needs a key collision. Never wait on sleeps or polling. A test that needs a timeout to pass is wrong.
- Upon request, behavior that agents or viewers see should get one integrated pass against `npm run dev` with real `curl` uploads and downloads. Never verify against production unless the maintainer asks.
- Run `npm run cf-typegen` after changing bindings in `wrangler.jsonc`, and check that `npx wrangler types --check` passes.

## Commits

Issues, pull requests, projects, and the wiki are turned off for this repository, so it reads as a published project rather than an open one. Changes land as commits on `main`. Do not try to open an issue or a pull request here, and do not turn those features back on.

- Never commit or push unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(worker): uploads named .constructor get a safe content type`.
- Body: the problem in a sentence or two, then how you fixed it. Close with what you verified and how.
- Changes to what viewers see need before/after evidence, such as the response headers or a screenshot of the rendered file. Motion or timing needs a short video. Upload it with file-host and link it in the commit body. Never commit evidence screenshots or assets.
- Keep each commit to one change. Unrelated changes go in separate commits.
- After pushing, check that CI is green on the latest commit. Fix real failures, and tell a real break from a runner flake before acting.

## Documentation

Most code changes do not need a documentation change. Agents can read the code.

- Architectural decisions, constraints that span files, and traps that are hard to discover from the source go in a comment beside the code they explain, as the existing comments on range handling and token comparison do. Before adding one, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append change summaries. Types, tests, and code already record the implementation. The glossary defines shared vocabulary; it is not a feature index.
- Keep a local implementation explanation in a nearby code comment. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior.
- The README's "For agents" and "Behaviour" sections are the user docs. They help agents and people upload files and understand what they get back. Before adding text, ask what task or decision it helps the reader with.
- Keep user docs free of implementation details that do not change how to use the service. Update the relevant section when how to use it changes.
- The README's "Setup" and "Commands" sections hold the maintainer's deploy and development procedures.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the repository.
- Issues are turned off, so there is no tracking item to update. A pushed commit is the implementation record. Do not preserve a second checklist in the repository.

## How it works

The Worker's `fetch` handler in `src/index.ts` decodes the path and routes by method. A `PUT` goes to `upload()`, which checks the token (`src/auth.ts`), the filename, the declared `Content-Length`, and the rate limiter, then builds a key with `generateKey()` (`src/keys.ts`) and streams the body into R2 with `If-None-Match: *`, so an existing key is never overwritten. The stored content type comes from the key's extension (`src/content-types.ts`), never from the uploader's header. A `GET` or `HEAD` goes to `download()`, which passes the request's conditional and range headers to R2 and adds caching, sandboxing, and privacy headers to every response.

Bindings are declared in `wrangler.jsonc`: the `BUCKET` R2 bucket, the `UPLOAD_RATE_LIMITER`, and the required `UPLOAD_TOKEN` secret. Their types are generated into `worker-configuration.d.ts`.

There are no separate architecture or glossary documents. This file, the README, and the code comments are the record.

## Where code lives

- `src/index.ts` - request routing, upload, download, and response helpers.
- `src/auth.ts` - constant-time token comparison.
- `src/keys.ts` - filename slugging and random key suffixes.
- `src/content-types.ts` - extension to `Content-Type` mapping.
- `test/` - Vitest specs that run inside the Workers runtime.
- `wrangler.jsonc` - Worker name, route, bindings, and secrets. `worker-configuration.d.ts` is generated from it by `npm run cf-typegen`; never edit it by hand.

## Taste

- Complexity belongs at the boundary. `src/keys.ts`, `src/auth.ts`, and `src/content-types.ts` stay pure and testable; the handlers in `src/index.ts` stay thin.
- The `fetch` handler only decodes and routes. Each method's work lives in its own function, and shared response building goes through `text()`.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Agents read the response body as a URL and nothing else. Do not add output, trailing whitespace, or decoration that an agent would have to strip.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features. The public download path and the upload token are not maintainer-only; changes there deserve the care the existing headers and checks show.
- Your knowledge of Cloudflare Workers APIs and limits may be outdated. Retrieve current documentation before any Workers, R2, or rate limiting task: https://developers.cloudflare.com/workers/, or the docs MCP server at `https://docs.mcp.cloudflare.com/mcp`.
- For limits and quotas, read the product's `/platform/limits/` page, such as `/workers/platform/limits/`. Other product docs live under `/r2/`, `/kv/`, `/d1/`, `/durable-objects/`, `/queues/`, `/vectorize/`, `/workers-ai/`, and `/agents/`.
- Node.js compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Error 1102 means CPU or memory was exceeded; check the limits page. All errors: https://developers.cloudflare.com/workers/observability/errors/
- If the Worker ever adopts Durable Objects or Workflows, read https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/ or https://developers.cloudflare.com/workflows/build/rules-of-workflows/ first.
