/**
 * `curl -T` sends no `Content-Type`, so the extension is usually the only signal
 * we have. Getting this right matters: GitHub and Slack decide whether to render
 * an upload inline or offer it as a download based on the type we serve.
 */

const CONTENT_TYPES: Record<string, string> = {
	// Images
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	bmp: "image/bmp",

	// Video
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	m4v: "video/x-m4v",

	// Audio
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	wav: "audio/wav",
	ogg: "audio/ogg",
	flac: "audio/flac",

	// Documents
	pdf: "application/pdf",
	html: "text/html; charset=utf-8",
	md: "text/markdown; charset=utf-8",
	txt: "text/plain; charset=utf-8",
	csv: "text/csv; charset=utf-8",
	json: "application/json; charset=utf-8",
	xml: "application/xml; charset=utf-8",

	// Archives
	zip: "application/zip",
	gz: "application/gzip",
	tar: "application/x-tar",
};

/**
 * Source files are served as plain text so a browser displays them instead of
 * downloading them, and so nothing we host is ever an executable script.
 */
const SOURCE_EXTENSIONS = new Set([
	"c",
	"cpp",
	"cs",
	"css",
	"go",
	"java",
	"js",
	"jsx",
	"log",
	"mjs",
	"php",
	"py",
	"rb",
	"rs",
	"sh",
	"sql",
	"swift",
	"toml",
	"ts",
	"tsx",
	"yaml",
	"yml",
]);

const PLAIN_TEXT = "text/plain; charset=utf-8";
const FALLBACK = "application/octet-stream";

/**
 * Resolves the type to store an upload under. Unknown extensions download as
 * opaque bytes instead of using a caller-controlled executable type.
 */
export function contentTypeFor(key: string): string {
	const dot = key.lastIndexOf(".");
	const extension = dot === -1 ? "" : key.slice(dot + 1).toLowerCase();

	if (extension in CONTENT_TYPES) {
		return CONTENT_TYPES[extension];
	}
	if (SOURCE_EXTENSIONS.has(extension)) {
		return PLAIN_TEXT;
	}

	return FALLBACK;
}
