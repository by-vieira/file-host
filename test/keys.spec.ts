import { describe, it, expect } from 'vitest';
import { generateKey } from '../src/keys';

/** Keys are `<slug>-<8 char suffix>[.ext]`. */
const SUFFIX = '[0-9a-z]{8}';

describe('generateKey', () => {
	it('slugifies the name and preserves the extension', () => {
		expect(generateKey('Login Flow (final).MP4')).toMatch(new RegExp(`^login-flow-final-${SUFFIX}\\.mp4$`));
	});

	it('gives each call a different suffix', () => {
		expect(generateKey('a.png')).not.toBe(generateKey('a.png'));
	});

	it('keeps only the basename when given a path', () => {
		expect(generateKey('../../etc/passwd')).toMatch(new RegExp(`^passwd-${SUFFIX}$`));
	});

	it('folds accents rather than dropping them', () => {
		expect(generateKey('café.png')).toMatch(new RegExp(`^cafe-${SUFFIX}\\.png$`));
	});

	it('falls back to a stem when nothing survives slugification', () => {
		expect(generateKey('!!!.png')).toMatch(new RegExp(`^file-${SUFFIX}\\.png$`));
	});

	it('treats a dotfile as a name, not an extension', () => {
		expect(generateKey('.env')).toMatch(new RegExp(`^env-${SUFFIX}$`));
	});

	it('ignores a trailing dot segment that is not a plausible extension', () => {
		expect(generateKey('report.v1.2-draft')).toMatch(new RegExp(`^report-v1-2-draft-${SUFFIX}$`));
	});
});
