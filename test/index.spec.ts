import { exports } from 'cloudflare:workers';
import { describe, it, expect, vi } from 'vitest';

const TOKEN = 'test-token-00000000000000000000000000000000';

function streamBody(value: string): ReadableStream<Uint8Array> {
	return new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(value));
			controller.close();
		},
	});
}

/** Uploads a file and returns the public URL the service handed back. */
async function upload(filename: string, body: string): Promise<string> {
	const response = await exports.default.fetch(`https://files.test/${filename}`, {
		method: 'PUT',
		headers: {
			'X-Upload-Token': TOKEN,
			'Content-Length': String(new TextEncoder().encode(body).byteLength),
		},
		body,
	});

	expect(response.status).toBe(200);
	return response.text();
}

describe('upload', () => {
	it('rejects a missing token with 401', async () => {
		const response = await exports.default.fetch('https://files.test/a.txt', {
			method: 'PUT',
			body: 'hi',
		});

		expect(response.status).toBe(401);
	});

	it('rejects a wrong token with 401', async () => {
		const response = await exports.default.fetch('https://files.test/a.txt', {
			method: 'PUT',
			headers: { 'X-Upload-Token': 'nope' },
			body: 'hi',
		});

		expect(response.status).toBe(401);
	});

	it('returns a public URL on the requested origin', async () => {
		const url = await upload('notes.txt', 'hello');
		expect(url).toMatch(/^https:\/\/files\.test\/notes-[0-9a-f]{32}\.txt$/);
	});

	it('requires a declared upload size', async () => {
		const request = new Request('https://files.test/notes.txt', {
			method: 'PUT',
			headers: { 'X-Upload-Token': TOKEN },
			body: streamBody('hello'),
		});
		const response = await exports.default.fetch(request);

		expect(response.status).toBe(411);
	});

	it('rejects a declared upload over 100 MB before storing it', async () => {
		const request = new Request('https://files.test/large.bin', {
			method: 'PUT',
			headers: {
				'X-Upload-Token': TOKEN,
				'Content-Length': '100000001',
			},
			body: streamBody('small'),
		});
		const response = await exports.default.fetch(request);

		expect(response.status).toBe(413);
	});

	it('does not overwrite an existing generated key', async () => {
		const randomValues = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
			new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
			return array;
		});

		try {
			const firstUrl = await upload('collision.txt', 'first');
			const second = await exports.default.fetch('https://files.test/collision.txt', {
				method: 'PUT',
				headers: {
					'X-Upload-Token': TOKEN,
					'Content-Length': '6',
				},
				body: 'second',
			});

			expect(second.status).toBe(409);
			expect(await (await exports.default.fetch(firstUrl)).text()).toBe('first');
		} finally {
			randomValues.mockRestore();
		}
	});
});

describe('download', () => {
	it('serves the uploaded bytes back without a token', async () => {
		const url = await upload('notes.txt', 'hello');
		const response = await exports.default.fetch(url);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('hello');
	});

	it('infers the content type from the extension', async () => {
		const response = await exports.default.fetch(await upload('clip.mp4', 'not-really-video'));
		expect(response.headers.get('Content-Type')).toBe('video/mp4');
	});

	it('does not trust a content type on an unknown extension', async () => {
		const response = await exports.default.fetch('https://files.test/payload.unknown', {
			method: 'PUT',
			headers: {
				'X-Upload-Token': TOKEN,
				'Content-Type': 'text/html',
				'Content-Length': '25',
			},
			body: '<script>alert(1)</script>',
		});

		const download = await exports.default.fetch(await response.text());
		expect(download.headers.get('Content-Type')).toBe('application/octet-stream');
	});

	it('404s an unknown key', async () => {
		expect((await exports.default.fetch('https://files.test/missing.txt')).status).toBe(404);
	});

	it('serves a byte range as 206', async () => {
		const url = await upload('digits.txt', '0123456789');
		const response = await exports.default.fetch(url, { headers: { Range: 'bytes=2-4' } });

		expect(response.status).toBe(206);
		expect(response.headers.get('Content-Range')).toBe('bytes 2-4/10');
		expect(await response.text()).toBe('234');
	});

	it('serves a suffix range as 206', async () => {
		const url = await upload('digits.txt', '0123456789');
		const response = await exports.default.fetch(url, { headers: { Range: 'bytes=-3' } });

		expect(response.status).toBe(206);
		expect(response.headers.get('Content-Range')).toBe('bytes 7-9/10');
		expect(await response.text()).toBe('789');
	});

	it('answers a matching If-None-Match with 304', async () => {
		const url = await upload('notes.txt', 'hello');
		const etag = (await exports.default.fetch(url)).headers.get('ETag');

		const response = await exports.default.fetch(url, { headers: { 'If-None-Match': etag! } });
		expect(response.status).toBe(304);
	});

	it('sandboxes uploaded HTML so it cannot use this origin', async () => {
		const response = await exports.default.fetch(await upload('report.html', '<h1>hi</h1>'));

		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		const policy = response.headers.get('Content-Security-Policy');
		expect(policy).toContain('sandbox allow-scripts');
		expect(policy).toContain("form-action 'none'");
		expect(policy).not.toContain('allow-forms');
		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
		expect(response.headers.get('X-Robots-Tag')).toContain('noindex');
	});
});
