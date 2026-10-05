# file-host

A Cloudflare Worker that gives coding agents a permanent public URL for
pull-request screenshots, recordings, and reports.

An agent can write code and open a pull request, but it has no simple way to put
a screenshot or a screen recording in one. GitHub's API has no way to attach a
file to a pull request. file-host gives the agent one `curl` command: it uploads
the file, and the response body is the URL to paste into the pull request.

Live at `https://file-host.vieira.tools`.

[![A test report uploaded to file-host and opened from the returned URL](https://file-host.vieira.tools/test-report-cb2c35c1311af2898e49c221020fb20a.png)](https://file-host.vieira.tools/test-report-b30398a7f7a8e05da1ebbb2a442ef140.html)

This is this project's own test report, uploaded with the command in
[For agents](#for-agents). The upload returned
[this URL](https://file-host.vieira.tools/test-report-b30398a7f7a8e05da1ebbb2a442ef140.html),
which serves the live HTML.

## Why I built it

The idea comes from
[Theo Browne's file host](https://www.youtube.com/watch?v=e1snsuY4lTI). He
noticed his agents going to awkward lengths to get a video into a pull request,
and gave them a single upload endpoint instead. I wanted the same thing for my
own agents. The goal was the smallest service that is still safe to leave open
on the internet.

Most of the design follows from two facts. Agents follow instructions
literally, and every uploaded file is public.

- **The response body is the URL.** There is no JSON to parse and no trailing
  newline. An agent pastes the body straight into Markdown.
- **URLs never change.** Each key gets a 128-bit random suffix, and R2 rejects a
  write to a key that already exists. A URL that appears in a merged pull
  request always shows the same bytes, so browsers can cache it for a year.
- **The uploader never chooses the content type.** The Worker picks it from the
  file extension. Unknown extensions download as `application/octet-stream`, so
  a caller cannot make the domain serve executable content by sending a
  `Content-Type` header.
- **HTML runs in a sandbox.** Test reports often need scripts, so HTML and SVG
  can run them, but a strict `Content-Security-Policy` gives them an opaque
  origin. A hosted page cannot read this domain's cookies, submit forms, or be
  framed.
- **Uploads stream into R2.** The Worker never holds a file in memory, so the
  100 MB cap is a policy choice, not a limit of the Worker's 128 MB of memory.
- **The token check leaks nothing through timing.** Both the presented token
  and the secret are hashed with SHA-256, then compared with
  `crypto.subtle.timingSafeEqual`. Hashing first keeps the comparison constant
  time even when the lengths differ.

## Tech stack

- **TypeScript**, with `strict` on.
- **Cloudflare Workers** runs the code.
- **Cloudflare R2** stores the files.
- **Workers Rate Limiting** caps uploads.
- **Wrangler 4** runs local development, deploys, and generates binding types.
- **Vitest 4** with `@cloudflare/vitest-plugin` runs the tests inside `workerd`,
  the same runtime as production, against a local R2 bucket.
- **tsgo**, the TypeScript native preview, typechecks the source and tests.
- **oxlint** lints the code and **oxfmt** formats it.
- **GitHub Actions** runs format, lint, typecheck, and tests on every push.

## For agents

Upload a file:

```bash
curl -sS --fail-with-body -X PUT -T <path-to-file> \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "https://file-host.vieira.tools/<filename>"
```

- Use only the file's basename for `<filename>`, such as `login-flow.mp4`. The
  server slugifies it and adds a random suffix, so names do not need to be unique.
- Treat the response body as the permanent public URL and use it directly.
- On HTTP 401, report that the token is wrong or unset. Do not retry.
- On HTTP 413, reduce the file below 100 MB. Do not retry the same file.
- On HTTP 429, wait for the `Retry-After` delay before retrying.
- On HTTP 409, retry once. The generated object key already exists.

Every upload becomes public. Never upload credentials, private source, customer
data, or another file that cannot be posted in a public pull request.

On Windows, `curl.exe` works the same way. Note that PowerShell aliases `curl` to
`Invoke-WebRequest`, so call `curl.exe` explicitly.

## Behaviour

| Request           | Result                                                |
| ----------------- | ----------------------------------------------------- |
| `PUT /<filename>` | Stores the body, returns the public URL as plain text |
| `GET /<key>`      | Serves the file publicly, no token required           |
| `GET /`           | Usage text                                            |
| Anything else     | `405`                                                 |

Uploads are streamed straight into R2 rather than buffered, so file size is not
bound by the Worker's 128 MB memory limit. The Worker requires `Content-Length`
and rejects values above 100,000,000 bytes. `curl -T` supplies the header for
regular files. The Worker also accepts at most 60 authenticated uploads per
minute in each Cloudflare location.

Stored keys look like
`login-flow-9f86d081884c7d659a2feaa0c55ad015.mp4`. The 128-bit suffix
makes collisions impractical. R2 also rejects a write if its key already exists,
so an upload cannot overwrite an immutable URL.

Downloads support range and conditional requests, so video seeking and browser
revalidation both work. Unknown extensions download as
`application/octet-stream`, regardless of the uploader's `Content-Type` header.

HTML and SVG run in an opaque sandbox. Reports can run scripts, but they cannot
submit forms, use this hostname's cookies or storage, set a base URL, or be
framed. Responses also disable sensitive browser permissions and search indexing.
Hosted pages still appear under this hostname, so only upload documents you would
publish yourself.

## Setup

You need Node.js (CI uses the current LTS release) and, to deploy, a Cloudflare
account with R2 enabled.

### Run it locally

1. Install the dependencies:

   ```bash
   npm install
   ```

2. Copy the local secrets file. It holds a token that only works locally:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Start the Worker. Wrangler prints the address it listens on, usually
   `http://localhost:8787`:

   ```bash
   npm run dev
   ```

4. In a second terminal, upload a file with the token from `.dev.vars`:

   ```bash
   curl -sS --fail-with-body -X PUT -T README.md \
     -H "X-Upload-Token: local-development-token-0000000000000000" \
     "http://localhost:8787/README.md"
   ```

   The response is the file's URL. Under `wrangler dev`, the URL names the
   production host, because the custom-domain route in `wrangler.jsonc` sets the
   request's host. To open the local copy, keep the key and swap the host:
   `http://localhost:8787/<key>`.

5. Run the tests once:

   ```bash
   npx vitest run
   ```

### Deploy

The Worker needs an R2 bucket and an upload token.

```bash
npx wrangler r2 bucket create file-host
npx wrangler secret put UPLOAD_TOKEN    # paste at least 32 random characters
npx wrangler deploy
```

Wrangler refuses to deploy if `UPLOAD_TOKEN` is missing. The configuration also
disables the public `workers.dev` route and version preview URLs. To deploy
under your own domain, change the `routes` pattern in `wrangler.jsonc`.

## Commands

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `npm run dev`        | Local development server       |
| `npm test`           | Run the tests in watch mode    |
| `npm run typecheck`  | Typecheck source and tests     |
| `npm run lint`       | Lint with oxlint               |
| `npm run format`     | Format with oxfmt              |
| `npm run deploy`     | Deploy to Cloudflare           |
| `npm run cf-typegen` | Regenerate `Env` from bindings |

Run `cf-typegen` after changing bindings in `wrangler.jsonc`.

## Limitations and next steps

These are the known gaps in the current version.

- **Files live forever.** There is no delete endpoint and no expiry. Removing a
  file means running `wrangler r2 object delete` by hand, and storage only
  grows. An R2 lifecycle rule could expire old uploads, though that would break
  the promise that a URL in an old pull request keeps working.
- **Every uploader shares one token.** Revoking one agent means rotating the
  token for all of them. Per-agent tokens, stored as hashes, would allow
  revoking one at a time and show who uploaded what.
- **The rate limit is shared, and covers uploads only.** All uploaders draw from
  one budget of 60 uploads per minute per Cloudflare location. Downloads have
  no limit, and each one is an R2 read.
- **Downloads are not cached at the edge.** The responses are marked immutable,
  but the Worker reads every `GET` from R2. Serving them through the Workers
  Cache API would cut R2 reads and latency for popular files.
- **Uploads stop at 100 MB.** Larger recordings would need R2 multipart
  uploads, which means a multi-request protocol that agents must follow.
- **Local URLs point at production.** Under `wrangler dev`, the returned URL
  names `file-host.vieira.tools` rather than the local server, as described in
  [Run it locally](#run-it-locally).

## License

[MIT](LICENSE)
