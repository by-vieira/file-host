/**
 * A file host for agents.
 *
 * `PUT /<filename>` with a valid `X-Upload-Token` streams the body into R2 and
 * responds with the permanent public URL. `GET /<key>` serves it back to anyone,
 * with range and conditional request support so video seeks and browser caching
 * both work.
 */

import { isValidToken } from "./auth";
import { contentTypeFor } from "./content-types";
import { generateKey } from "./keys";

/** Every key carries a random suffix, so a URL always points at the same bytes. */
const IMMUTABLE = "public, max-age=31536000, immutable";
const MAX_UPLOAD_BYTES = 100_000_000;
const MIN_TOKEN_LENGTH = 32;
const ALLOWED_METHODS = "GET, HEAD, PUT, OPTIONS";

const USAGE = `file-host.vieira.tools

Upload:
  curl -sS --fail-with-body -X PUT -T <path-to-file> \\
    -H "X-Upload-Token: $FILE_HOST_TOKEN" \\
    https://file-host.vieira.tools/<filename>

The response body is the permanent public URL. Use only the basename for
<filename>; it is slugified and given a random suffix, so it need not be unique.
Files are public. The maximum upload size is 100 MB.
`;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		const path = decodePath(url.pathname);
		if (path === null) {
			return text("Malformed path\n", 400);
		}

		switch (request.method) {
			case "PUT":
				return upload(request, env, url.host, path);
			case "GET":
			case "HEAD":
				return path === "" ? text(USAGE) : download(request, env, path);
			case "OPTIONS":
				return new Response(null, { status: 204, headers: { allow: ALLOWED_METHODS } });
			default:
				return text("Method not allowed\n", 405, { allow: ALLOWED_METHODS });
		}
	},
} satisfies ExportedHandler<Env>;

async function upload(
	request: Request,
	env: Env,
	host: string,
	filename: string,
): Promise<Response> {
	// Distinct from 401: the caller cannot fix this by presenting a better token.
	if (!env.UPLOAD_TOKEN) {
		return text("Server misconfigured: UPLOAD_TOKEN is not set\n", 500);
	}
	if (env.UPLOAD_TOKEN.length < MIN_TOKEN_LENGTH) {
		return text(
			`Server misconfigured: UPLOAD_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters\n`,
			500,
		);
	}

	const providedToken = request.headers.get("X-Upload-Token");
	if (!(await isValidToken(providedToken, env.UPLOAD_TOKEN))) {
		return text("Invalid or missing X-Upload-Token\n", 401);
	}

	if (filename === "") {
		return text("Provide a filename: PUT /<filename>\n", 400);
	}
	if (request.body === null) {
		return text("Request body is empty\n", 400);
	}

	const uploadSize = declaredUploadSize(request);
	if (uploadSize === null) {
		return text("Content-Length is required for uploads\n", 411);
	}
	if (uploadSize > MAX_UPLOAD_BYTES) {
		return text("Upload exceeds the 100 MB limit\n", 413);
	}

	const { success } = await env.UPLOAD_RATE_LIMITER.limit({ key: "uploads" });
	if (!success) {
		return text("Upload rate limit exceeded\n", 429, { "Retry-After": "60" });
	}

	const key = generateKey(filename);

	// Keeping the original body preserves the known length that R2 requires for a
	// streaming put. Cloudflare rejects requests whose bytes disagree with the
	// Content-Length header.
	const stored = await env.BUCKET.put(key, request.body, {
		onlyIf: new Headers({ "If-None-Match": "*" }),
		httpMetadata: {
			contentType: contentTypeFor(key),
			cacheControl: IMMUTABLE,
			// Inline, so images and video render in a browser rather than downloading.
			contentDisposition: "inline",
		},
		customMetadata: { originalFilename: filename.slice(0, 256) },
	});

	// A collision is vanishingly unlikely, but overwriting would break every cache
	// and caller that already treats the URL as immutable.
	if (stored === null) {
		return text("Generated key already exists; retry the upload\n", 409);
	}

	// Always https, never the inbound scheme: this URL is permanent and gets pasted
	// into pull requests, so it must not depend on how the upload happened to arrive.
	// No trailing newline, because callers are told to use the body directly as the URL.
	return text(`https://${host}/${key}`);
}

async function download(request: Request, env: Env, key: string): Promise<Response> {
	const object = await env.BUCKET.get(key, {
		onlyIf: request.headers,
		range: request.headers,
	});
	if (object === null) {
		return text("Not found\n", 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("ETag", object.httpEtag);
	headers.set("Cache-Control", IMMUTABLE);
	headers.set("Accept-Ranges", "bytes");
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
	headers.set("Referrer-Policy", "no-referrer");
	headers.set("Cross-Origin-Opener-Policy", "same-origin");
	headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
	// HTML reports can run scripts, but cannot keep this origin, submit forms, set a
	// base URL, or be framed by another site.
	headers.set(
		"Content-Security-Policy",
		"sandbox allow-scripts; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	);

	// R2 signals a failed `onlyIf` by returning the object without a body.
	if (!("body" in object)) {
		return new Response(null, { status: preconditionStatus(request), headers });
	}

	// Never answer 206 to a request that did not ask for a range, whatever R2 reports.
	const range = request.headers.has("Range") ? resolveRange(object.range, object.size) : null;
	const status = range === null ? 200 : 206;
	if (range !== null) {
		headers.set("Content-Range", `bytes ${range.start}-${range.end}/${object.size}`);
	}

	// HEAD shares every header with GET but must not carry a body. Without one the
	// runtime has nothing to measure, so the length has to be stated explicitly —
	// clients probing a file's size before downloading it depend on this.
	if (request.method === "HEAD") {
		const length = range === null ? object.size : range.end - range.start + 1;
		headers.set("Content-Length", String(length));

		return new Response(null, { status, headers });
	}

	return new Response(object.body, { status, headers });
}

/**
 * R2 collapses every failed precondition into the same bodyless response, so the
 * request headers are what distinguish them. `If-None-Match` and
 * `If-Modified-Since` mean the client already holds the bytes (304); the
 * remaining conditionals are genuine failures (412).
 */
function preconditionStatus(request: Request): 304 | 412 {
	const revalidating =
		request.headers.has("If-None-Match") || request.headers.has("If-Modified-Since");

	return revalidating ? 304 : 412;
}

/**
 * The declared `R2Range` is a union of three shapes, but the runtime returns a
 * single object carrying all three keys with the unused ones set to `undefined`.
 * Presence therefore has to be tested by value; `in` matches every time.
 */
type RuntimeRange = { offset?: number; length?: number; suffix?: number };

/**
 * Normalises R2's range shapes into inclusive byte bounds, or `null` when no
 * range was actually applied and the whole object should be served.
 */
function resolveRange(
	range: R2Range | undefined,
	size: number,
): { start: number; end: number } | null {
	if (range === undefined) {
		return null;
	}

	const { offset, length, suffix } = range as RuntimeRange;
	if (suffix !== undefined) {
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	if (offset === undefined && length === undefined) {
		return null;
	}

	const start = offset ?? 0;
	return { start, end: start + (length ?? size - start) - 1 };
}

/** Percent-decodes the path, rejecting malformed escapes rather than throwing. */
function decodePath(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname.slice(1));
	} catch {
		return null;
	}
}

function declaredUploadSize(request: Request): number | null {
	const value = request.headers.get("Content-Length");
	if (value === null || !/^\d+$/.test(value)) {
		return null;
	}

	const size = Number(value);
	return Number.isSafeInteger(size) ? size : null;
}

function text(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(body, {
		status,
		headers: { "Content-Type": "text/plain; charset=utf-8", ...extraHeaders },
	});
}
