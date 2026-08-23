# files-service

A Cloudflare Worker that lets agents upload arbitrary files to R2 and get back a
permanent public URL, so screenshots and screen recordings can be embedded in a
pull request without any of the usual contortions.

Live at `https://files.vieira.tools`.

## For agents

Upload a file:

```bash
curl -sS --fail-with-body -X PUT -T <path-to-file> \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "https://files.vieira.tools/<filename>"
```

- Use only the file's basename for `<filename>`, such as `login-flow.mp4`. The
  server slugifies it and adds a random suffix, so names do not need to be unique.
- Treat the response body as the permanent public URL and use it directly.
- On HTTP 401, report that the token is wrong or unset. Do not retry.

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
bound by the Worker's 128 MB memory limit. It is still bound by Cloudflare's
**100 MB request body limit**, which applies on both the Free and Paid plans.
Larger files need multipart upload, which would mean the client can no longer be
a single `curl -T`.

Stored keys look like `login-flow-k3f9dq2m.mp4`. Because the suffix makes every
key unique, responses are served `immutable` and cached for a year.

Downloads support range and conditional requests, so video seeking and browser
revalidation both work. Uploaded content is served with `nosniff` and a
`Content-Security-Policy: sandbox`, which keeps hostile HTML or SVG in an opaque
origin where it cannot reach anything else on the domain.

## Setup

The Worker needs an R2 bucket and an upload token.

```bash
npx wrangler r2 bucket create files-service
npx wrangler secret put UPLOAD_TOKEN    # paste a long random string
npx wrangler deploy
```

For local development, copy `.dev.vars.example` to `.dev.vars` and run
`npm run dev`. The local token is separate from the deployed one.

## Commands

| Command              | Purpose                        |
| -------------------- | ------------------------------ |
| `npm run dev`        | Local development server       |
| `npm test`           | Run the test suite             |
| `npm run typecheck`  | Typecheck source and tests     |
| `npm run deploy`     | Deploy to Cloudflare           |
| `npm run cf-typegen` | Regenerate `Env` from bindings |

Run `cf-typegen` after changing bindings in `wrangler.jsonc`.
