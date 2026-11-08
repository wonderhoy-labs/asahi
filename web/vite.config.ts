import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { asahi } from "./plugins/asahi.ts";

export default defineConfig({
	// Relative, so that a copy of the site works from any address.
	base: "./",
	plugins: [react(), asahi()],
	build: { target: "esnext", chunkSizeWarningLimit: 1500 },
	test: { environment: "node", include: ["src/**/*.test.ts", "plugins/**/*.test.ts"] },
});
