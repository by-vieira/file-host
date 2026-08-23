import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				// Per-test storage rollback trips over file locks on Windows, and the
				// suite does not need it: every upload lands under a random key.
				isolatedStorage: false,
				// Set here rather than read from .dev.vars so the suite does not depend
				// on a gitignored file.
				miniflare: { bindings: { UPLOAD_TOKEN: 'test-token' } },
			},
		},
	},
});
