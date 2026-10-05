import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// Set here rather than read from .dev.vars so the suite does not depend
			// on a gitignored file.
			miniflare: { bindings: { UPLOAD_TOKEN: "test-token-00000000000000000000000000000000" } },
		}),
	],
});
