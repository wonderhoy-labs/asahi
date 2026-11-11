// Packs web/dist into a signed web bundle, so Asahi can be installed as an Isolated Web App, with Shiho's library.
//
// The key is Ed25519 PEM text, from the WEB_BUNDLE_KEY environment variable (CI's ASAHI_IWA_KEY secret) or from
// ~/.config/wonderhoy-labs/asahi/iwa-key.pem. The key decides the app's address, isolated-app://<Web Bundle ID>/, so
// it's never replaced. Without a key this says so and does nothing, so builds without the secret still pass.
//
//     pnpm bundle            writes web/dist/asahi.swbn
//     pnpm bundle --id       prints the Web Bundle ID and exits

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { signWebBundle, webBundleId } from "@wonderhoy-labs/shiho/bundle";

const dist = fileURLToPath(new URL("../web/dist", import.meta.url));
const output = "asahi.swbn";
const keyFile = join(homedir(), ".config", "wonderhoy-labs", "asahi", "iwa-key.pem");

const pem = process.env.WEB_BUNDLE_KEY?.trim() || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : null);
if (!pem) {
	process.stdout.write(`No signing key in WEB_BUNDLE_KEY or ${keyFile}, so no ${output}.\n`);
	process.exit(0);
}
if (process.argv.includes("--id")) {
	process.stdout.write(`${webBundleId(pem)}\n`);
	process.exit(0);
}
if (!existsSync(join(dist, "index.html"))) throw new Error("Build the site first: pnpm --filter ./web build");
const { id, bytes } = await signWebBundle(dist, pem);
writeFileSync(join(dist, output), bytes);
process.stdout.write(`Wrote web/dist/${output} for isolated-app://${id}/\n`);
