import { readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { createAdbBridge } from "./dev-adb.ts";
import { createWispServer } from "./dev-wisp.ts";
import { thirdPartyNotices } from "./notices.ts";

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const WISP_PATH = "/wisp/";
const ADB_PATH = "/__asahi/adb";

/**
 * WebSockets aren't covered by the same-origin policy, so any site you visit could otherwise reach these
 * two and use them to browse your local network or drive adb. Only this page may use them.
 */
function isFromThisPage(request: IncomingMessage): boolean {
	const { origin, host } = request.headers;
	if (!origin || !host) return false;
	try {
		const url = new URL(origin);
		const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
		return local && url.host === host;
	} catch {
		return false;
	}
}

function serveWisp(httpServer: Server | null, withAdb: boolean) {
	const wisp = createWispServer();
	const adb = withAdb ? createAdbBridge() : null;
	httpServer?.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		if (path !== WISP_PATH && (path !== ADB_PATH || !adb)) return;
		if (!isFromThisPage(request)) {
			socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			socket.destroy();
			return;
		}
		if (path === WISP_PATH) wisp.handleUpgrade(request, socket, head);
		else adb?.handleUpgrade(request, socket, head);
	});
}

/**
 * Tells the page its version and the version of Shira's app it carries. The apps themselves come with the Shira and
 * Shinonome libraries.
 *
 * During development this also runs what production gets from elsewhere: a Wisp server for the page to
 * use, and a way to reach an emulator, which has no USB for the page to find it through.
 */
export function asahi(): Plugin {
	const version = readFileSync(repo("VERSION"), "utf8").trim();
	const shira = (
		JSON.parse(readFileSync(repo("web/node_modules/@wonderhoy-labs/shira/package.json"), "utf8")) as {
			version: string;
		}
	).version;
	const [major = 0, minor = 0, patch = 0] = shira.split(".").map(Number);

	return {
		name: "asahi",

		config: () => ({
			define: {
				__ASAHI_VERSION__: JSON.stringify(version),
				__SHIRA_VERSION__: JSON.stringify(shira),
				__SHIRA_VERSION_CODE__: major * 10_000 + minor * 100 + patch,
			},
		}),

		configureServer(server) {
			const httpServer = server.httpServer as Server | null;
			serveWisp(httpServer, true);
		},

		// So that a production build can be tried from start to finish, without another server to run.
		configurePreviewServer(server) {
			serveWisp(server.httpServer as Server, false);
		},

		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "third-party-licenses.txt",
				source: thirdPartyNotices(repo("web")),
			});
		},

		// This page can do anything adb can, so it only runs what came with it, and only talks to Wisp servers.
		transformIndexHtml: {
			order: "post",
			handler(html, context) {
				if (context.server) return html;
				const policy = [
					"default-src 'self'",
					"connect-src 'self' ws: wss:",
					"img-src 'self' data:",
					"style-src 'self' 'unsafe-inline'",
					"font-src 'self' data:",
					"worker-src 'self'",
					"object-src 'none'",
					"base-uri 'none'",
				].join("; ");
				return html.replace(
					'<meta charset="utf-8" />',
					`<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
				);
			},
		},
	};
}
