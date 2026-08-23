/**
 * Object keys are derived from the uploaded filename so they stay recognisable,
 * then given a random suffix so callers never have to coordinate on uniqueness
 * and every returned URL is immutable.
 */

const MAX_SLUG_LENGTH = 64;
const MAX_EXTENSION_LENGTH = 16;
const SUFFIX_LENGTH = 8;

/** Exactly 32 characters, so masking a random byte with 31 is unbiased. Omits
 *  i/l/o/u to avoid lookalikes and accidental words. */
const SUFFIX_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * Turns a client-supplied filename into a safe, unique R2 key.
 * `Login Flow (final).MP4` becomes something like `login-flow-final-k3f9dq2m.mp4`.
 */
export function generateKey(filename: string): string {
	const basename = filename.split(/[/\\]/).pop() ?? '';
	const { stem, extension } = splitExtension(basename);
	return `${slugify(stem)}-${randomSuffix()}${extension}`;
}

/**
 * Splits off a trailing extension, but only when it looks like a real one.
 * A dot at position 0 (`.env`) or a long/odd suffix (`v1.2-notes`) is treated as
 * part of the name rather than an extension.
 */
function splitExtension(basename: string): { stem: string; extension: string } {
	const dot = basename.lastIndexOf('.');
	if (dot <= 0) return { stem: basename, extension: '' };

	const extension = basename.slice(dot + 1).toLowerCase();
	if (!isPlausibleExtension(extension)) return { stem: basename, extension: '' };

	return { stem: basename.slice(0, dot), extension: `.${extension}` };
}

function isPlausibleExtension(extension: string): boolean {
	return extension.length <= MAX_EXTENSION_LENGTH && /^[a-z0-9]+$/.test(extension);
}

/** Lowercase alphanumeric words joined by hyphens. Never returns an empty string. */
function slugify(stem: string): string {
	const slug = stem
		// NFKD splits accented letters into a base letter plus a combining mark,
		// so dropping the marks preserves `café` as `cafe` rather than `caf-`.
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, MAX_SLUG_LENGTH)
		.replace(/^-+|-+$/g, '');

	return slug || 'file';
}

function randomSuffix(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
	return Array.from(bytes, (byte) => SUFFIX_ALPHABET[byte & 31]).join('');
}
