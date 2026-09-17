import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose. That config loads the flue() and
// cloudflare() plugins, which boot the Workers runtime and the generated
// worker entry. These tests cover pure modules, so running them in plain Node
// keeps them fast and keeps a runtime problem from reading as a test failure.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
});
