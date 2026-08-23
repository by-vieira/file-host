/**
 * Compares the caller's `X-Upload-Token` against the configured secret without
 * leaking the answer through timing.
 *
 * `crypto.subtle.timingSafeEqual` throws when the two buffers differ in length,
 * and the length of a rejected guess is itself a leak, so both sides are hashed
 * to a fixed 32 bytes first and the digests are compared instead.
 */
export async function isValidToken(provided: string | null, expected: string): Promise<boolean> {
	if (provided === null) return false;

	const [providedDigest, expectedDigest] = await Promise.all([sha256(provided), sha256(expected)]);

	return crypto.subtle.timingSafeEqual(providedDigest, expectedDigest);
}

function sha256(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}
