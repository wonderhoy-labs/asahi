// Airi's Linux apps, listed over adb through Airi's own provider, and the links that open one alone.

import type { Phone } from "../adb/phone";

/** Airi's package. */
export const AIRI_PACKAGE = "com.wonderhoylabs.airi";
const APPS_URI = "content://com.wonderhoylabs.airi.apps/apps";

/** A Linux app Airi can open, by its desktop file ID. */
export interface LinuxApp {
	desktopId: string;
	name: string;
	/** Whether Airi put it on the phone's launcher. */
	onLauncher: boolean;
}

/** Whether Airi is on the phone. Asking doesn't start it. */
export async function hasAiri(phone: Phone): Promise<boolean> {
	return (await phone.shell(`pm path ${AIRI_PACKAGE}`)).includes("package:");
}

/**
 * The rows `content query` prints for Airi's provider. Each row is `desktop_id`, `on_launcher` and `name`, in that order,
 * so the name, which can hold anything, is the rest of the line.
 */
export function parseLinuxApps(output: string): LinuxApp[] {
	const apps: LinuxApp[] = [];
	for (const line of output.split("\n")) {
		const match = /^Row: \d+ desktop_id=(.+?), on_launcher=([01]), name=(.*)$/.exec(line.trimEnd());
		if (match) apps.push({ desktopId: match[1], onLauncher: match[2] === "1", name: match[3] });
	}
	return apps;
}

/** The Linux apps Airi can open now. Empty while Linux isn't running. */
export async function listLinuxApps(phone: Phone): Promise<LinuxApp[]> {
	const output = await phone.shell(`content query --uri ${APPS_URI}`);
	if (/Could not find provider|Unknown authority/.test(output)) {
		throw new Error("This Airi can't list its apps. Update Airi to 0.3.0 or later.");
	}
	if (/Exception/.test(output) && !output.includes("Row:")) {
		throw new Error(output.trim().split("\n")[0] ?? "Airi didn't answer.");
	}
	return parseLinuxApps(output);
}

/** Airi's link for an app in Android's terminal. */
export function airiLink(desktopId: string): string {
	return `airi://app/${desktopId}`;
}

/** Minori's link for an app in one of its machines, which Airi then shows. */
export function machineAppLink(vm: string, desktopId: string): string {
	return `minori://vm/${encodeURIComponent(vm)}/app/${desktopId}`;
}
