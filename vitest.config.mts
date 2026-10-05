import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Wrangler reads required secrets from process.env. Setting the token here keeps
// the suite independent of the gitignored .dev.vars and of any real token in the
// shell.
process.env.UPLOAD_TOKEN = "test-token-00000000000000000000000000000000";

export default defineConfig({
	plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
