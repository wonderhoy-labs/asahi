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
/** Where an Isolated Web App's manifest has to be. */
const IWA_MANIFEST_PATH = ".well-known/manifest.webmanifest";

interface Brand {
	name: string;
	tagline: string;
	color: string;
}

const ICONS = [
	{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
	{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
];

/** The web app manifest that makes the site installable as a PWA. Paths are relative, for GitHub Pages. */
export function pwaManifest(brand: Brand): string {
	return `${JSON.stringify(
		{
			name: brand.name,
			short_name: brand.name,
			description: brand.tagline,
			id: "./",
			start_url: "./",
			scope: "./",
			display: "standalone",
			theme_color: brand.color,
			background_color: brand.color,
			icons: [...ICONS, { ...ICONS[1], purpose: "maskable" }],
		},
		null,
		"\t",
	)}\n`;
}

/**
 * The Isolated Web App's manifest. Direct Sockets let Asahi open the phone's connections itself, through Shiho's
 * library, and reach the adb server on this computer, which also needs Local Network Access.
 */
export function iwaManifest(brand: Brand, version: string): string {
	return `${JSON.stringify(
		{
			name: brand.name,
			short_name: brand.name,
			description: brand.tagline,
			version,
			id: "/",
			start_url: "/",
			scope: "/",
			display: "standalone",
			theme_color: brand.color,
			background_color: brand.color,
			icons: ICONS.map((icon) => ({ ...icon, src: `/${icon.src}` })),
			permissions_policy: {
				"cross-origin-isolated": ["self"],
				"direct-sockets": ["self"],
				"local-network": ["self"],
				"local-network-access": ["self"],
				"loopback-network": ["self"],
				usb: ["self"],
			},
		},
		null,
		"\t",
	)}\n`;
}

/**
 * A service worker for the PWA. It keeps the files of the build it came with, so Asahi opens without a connection,
 * and fetches the page itself first so a new version shows as soon as it's published. Everything else, such as a Wisp
 * server, it leaves alone.
 */
export function serviceWorker(version: string, files: string[]): string {
	return `// Asahi ${version}. Written by the build; see web/plugins/asahi.ts.
const CACHE = ${JSON.stringify(`asahi-${version}`)};
const FILES = ${JSON.stringify(["./", ...files])};

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request)
				.then((response) => {
					const copy = response.clone();
					caches.open(CACHE).then((cache) => cache.put("./", copy));
					return response;
				})
				.catch(() => caches.match("./")),
		);
		return;
	}
	event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
`;
}
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
	const brand = (JSON.parse(readFileSync(repo("package.json"), "utf8")) as { wonderhoy: Brand }).wonderhoy;

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

		generateBundle(_options, bundle) {
			this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: pwaManifest(brand) });
			this.emitFile({ type: "asset", fileName: IWA_MANIFEST_PATH, source: iwaManifest(brand, version) });
			// What the build made, apart from the big phone apps, which only matter with a phone plugged in anyway.
			const built = Object.keys(bundle).filter(
				(name) => !name.endsWith(".apk") && !name.endsWith(".map") && name !== "index.html",
			);
			const files = [
				...built,
				"manifest.webmanifest",
				"favicon.png",
				"logo.webp",
				...ICONS.map((icon) => icon.src),
			];
			this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker(version, files) });
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
