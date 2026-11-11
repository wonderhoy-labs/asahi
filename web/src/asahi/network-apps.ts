import { SHIHO_APP } from "@wonderhoy-labs/shiho";
import shihoApkUrl from "@wonderhoy-labs/shiho/shiho.apk?url";
import { type LinkApp, SHIRA_APP } from "@wonderhoy-labs/shira";
import shiraApkUrl from "@wonderhoy-labs/shira/shira.apk?url";

/** Where the phone's traffic goes: through Shira and a Wisp server, or through Shiho and this computer. */
export type NetworkRoute = "wisp" | "computer";

/** The app on the phone that carries its network for a route, and the copy of it this page carries. */
export interface NetworkApp {
	/** The app's name, as the phone shows it. */
	name: "Shira" | "Shiho";
	link: LinkApp;
	apkUrl: string;
	version: string;
	versionCode: number;
	releasesUrl: string;
}

export const NETWORK_APPS: Record<NetworkRoute, NetworkApp> = {
	wisp: {
		name: "Shira",
		link: SHIRA_APP,
		apkUrl: shiraApkUrl,
		version: __SHIRA_VERSION__,
		versionCode: __SHIRA_VERSION_CODE__,
		releasesUrl: "https://github.com/wonderhoy-labs/shira/releases",
	},
	computer: {
		name: "Shiho",
		link: SHIHO_APP,
		apkUrl: shihoApkUrl,
		version: __SHIHO_VERSION__,
		versionCode: __SHIHO_VERSION_CODE__,
		releasesUrl: "https://github.com/wonderhoy-labs/shiho/releases",
	},
};
