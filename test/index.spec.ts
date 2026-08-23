import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

const TOKEN = 'test-token';

/** Uploads a file and returns the public URL the service handed back. */
async function upload(filename: string, body: string): Promise<string> {
	const response = await SELF.fetch(`https://files.test/${filename}`, {
		method: 'PUT',
		headers: { 'X-Upload-Token': TOKEN },
		body,
	});

	expect(response.status).toBe(200);
	return response.text();
}

describe('upload', () => {
	it('rejects a missing token with 401', async () => {
		const response = await SELF.fetch('https://files.test/a.txt', {
			method: 'PUT',
			body: 'hi',
		});

		expect(response.status).toBe(401);
	});

	it('rejects a wrong token with 401', async () => {
		const response = await SELF.fetch('https://files.test/a.txt', {
			method: 'PUT',
			headers: { 'X-Upload-Token': 'nope' },
			body: 'hi',
		});

		expect(response.status).toBe(401);
	});

	it('returns a public URL on the requested origin', async () => {
		const url = await upload('notes.txt', 'hello');
		expect(url).toMatch(/^https:\/\/files\.test\/notes-[0-9a-z]{8}\.txt$/);
	});
});

describe('download', () => {
	it('serves the uploaded bytes back without a token', async () => {
		const url = await upload('notes.txt', 'hello');
		const response = await SELF.fetch(url);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('hello');
	});

	it('infers the content type from the extension', async () => {
		const response = await SELF.fetch(await upload('clip.mp4', 'not-really-video'));
		expect(response.headers.get('Content-Type')).toBe('video/mp4');
	});

	it('404s an unknown key', async () => {
		expect((await SELF.fetch('https://files.test/missing.txt')).status).toBe(404);
	});

	it('serves a byte range as 206', async () => {
		const url = await upload('digits.txt', '0123456789');
		const response = await SELF.fetch(url, { headers: { Range: 'bytes=2-4' } });

		expect(response.status).toBe(206);
		expect(response.headers.get('Content-Range')).toBe('bytes 2-4/10');
		expect(await response.text()).toBe('234');
	});

	it('serves a suffix range as 206', async () => {
		const url = await upload('digits.txt', '0123456789');
		const response = await SELF.fetch(url, { headers: { Range: 'bytes=-3' } });

		expect(response.status).toBe(206);
		expect(response.headers.get('Content-Range')).toBe('bytes 7-9/10');
		expect(await response.text()).toBe('789');
	});

	it('answers a matching If-None-Match with 304', async () => {
		const url = await upload('notes.txt', 'hello');
		const etag = (await SELF.fetch(url)).headers.get('ETag');

		const response = await SELF.fetch(url, { headers: { 'If-None-Match': etag! } });
		expect(response.status).toBe(304);
	});

	it('sandboxes uploaded HTML so it cannot use this origin', async () => {
		const response = await SELF.fetch(await upload('report.html', '<h1>hi</h1>'));

		expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
		expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
	});
});
