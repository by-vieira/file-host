# file-host

A Cloudflare Worker that lets agents upload files to R2 and get back a permanent
public URL for pull-request screenshots, recordings, and reports.

Coding agents can attach text to a pull request but have no simple place to put
a video or screenshot. This Worker gives them one `curl` command for it. The idea
comes from [Theo Browne's file host](https://www.youtube.com/watch?v=e1snsuY4lTI).

Live at `https://file-host.vieira.tools`.

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

The Worker needs an R2 bucket and an upload token.

```bash
npx wrangler r2 bucket create file-host
npx wrangler secret put UPLOAD_TOKEN    # paste at least 32 random characters
npx wrangler deploy
```

Wrangler refuses to deploy if `UPLOAD_TOKEN` is missing. The configuration also
disables the public `workers.dev` route and version preview URLs.

For local development, copy `.dev.vars.example` to `.dev.vars` and run
`npm run dev`. The local token is separate from the deployed one.

## Commands

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `npm run dev`        | Local development server       |
| `npm test`           | Run the test suite             |
| `npm run typecheck`  | Typecheck source and tests     |
| `npm run lint`       | Lint with oxlint               |
| `npm run format`     | Format with oxfmt              |
| `npm run deploy`     | Deploy to Cloudflare           |
| `npm run cf-typegen` | Regenerate `Env` from bindings |

Run `cf-typegen` after changing bindings in `wrangler.jsonc`.
