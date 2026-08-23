Based on: https://www.youtube.com/watch?v=e1snsuY4lTI

Theo Browne has a cloudflare worker service, that essentially allows agents to arbitrary files to R2 with a public URL which they can use to embed "the things" in pull requests because he noticed them doing "nasty shit" to get a video in a PR (Pull Request). His solution solved that.

Agents can access this service via the bash `curl` command (unsure what it is on Windows) like this:

```bash
curl -sS --fail-with-body -X PUT -T <path-to-file> \
  -H "X-Upload-Token: $FILE_HOST_TOKEN" \
  "https:/{{domain}}/<filename>"
```

Theo Browne also instructs his agents to:

- Use only the file's basename for `<filename>`, such as `login-flow.mp4`. The server slugifies it and adds a random suffix, so names do not need to be unique.
- Treat the response body as the permanent public URL and use it directly.
- On HTTP 401, report that the token is wrong or unset. Do not retry