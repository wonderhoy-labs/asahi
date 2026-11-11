// What the tab can show, how Shinonome is asked for the ones it draws, and which of them a phone can do.

import type { SessionMode } from "@wonderhoy-labs/shinonome";
import type { Machine } from "./minori";

/**
 * What the tab shows. Android's desktop, its screen, and one Android or Linux app alone come through Shinonome, on the
 * same canvas; a Minori machine's desktop or console comes through Minori.
 */
export type Source =
	| { kind: "desktop" }
	| { kind: "screen" }
	| { kind: "android-app"; component: string; name: string }
	| { kind: "linux-app"; app: string; name: string }
	| { kind: "machine"; vm: string; name: string; view: "desktop" | "console" };

export type MachineSource = Extract<Source, { kind: "machine" }>;

/** The six kinds of thing to show, as the onboarding offers them. Each but the first two needs something picked. */
export type Setup =
	| "android-desktop"
	| "android-screen"
	| "android-app"
	| "linux-app"
	| "linux-desktop"
	| "linux-console";

export const SETUPS: Setup[] = [
	"android-desktop",
	"android-screen",
	"android-app",
	"linux-app",
	"linux-desktop",
	"linux-console",
];

export const DEFAULT_SOURCE: Source = { kind: "desktop" };

/** The kind of thing a source is. */
export function setupOf(source: Source): Setup {
	switch (source.kind) {
		case "desktop":
			return "android-desktop";
		case "screen":
			return "android-screen";
		case "android-app":
			return "android-app";
		case "linux-app":
			return "linux-app";
		case "machine":
			return source.view === "desktop" ? "linux-desktop" : "linux-console";
	}
}

/** What Shinonome's server has to show for a source, or null for a Minori machine. */
export function shinonomeMode(source: Source): SessionMode | null {
	switch (source.kind) {
		case "desktop":
			return { kind: "desktop" };
		case "screen":
			return { kind: "mirror" };
		case "android-app":
			return { kind: "app", app: source.component };
		case "linux-app":
			return { kind: "app", app: source.app };
		case "machine":
			return null;
	}
}

export const SETUP_TITLES: Record<Setup, string> = {
	"android-desktop": "Android desktop",
	"android-screen": "Android screen",
	"android-app": "Android app",
	"linux-app": "Linux app",
	"linux-desktop": "Linux desktop",
	"linux-console": "Linux console",
};

/** What the source menu's button says. */
export function sourceLabel(source: Source): string {
	switch (source.kind) {
		case "desktop":
		case "screen":
			return SETUP_TITLES[setupOf(source)];
		case "android-app":
		case "linux-app":
			return source.name;
		case "machine":
			return `${source.name} ${source.view}`;
	}
}

export function sameSource(a: Source, b: Source): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** A source read back from storage, or null if it isn't one. */
export function parseSource(text: string): Source | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const item = value as Record<string, unknown>;
	const has = (key: string) => typeof item[key] === "string" && (item[key] as string).length > 0;
	switch (item.kind) {
		case "desktop":
		case "screen":
			return { kind: item.kind };
		case "android-app":
			return has("component") && has("name")
				? { kind: "android-app", component: item.component as string, name: item.name as string }
				: null;
		case "linux-app":
			return has("app") && has("name")
				? { kind: "linux-app", app: item.app as string, name: item.name as string }
				: null;
		case "machine":
			return has("vm") && has("name") && (item.view === "desktop" || item.view === "console")
				? { kind: "machine", vm: item.vm as string, name: item.name as string, view: item.view }
				: null;
		default:
			return null;
	}
}

/** What's known about what a phone can show. */
export interface Capabilities {
	/** Whether the phone has been asked if it can make a desktop, and if it can't, why. */
	desktopChecked: boolean;
	desktopProblem: string | null;
	airiInstalled: boolean;
	minoriInstalled: boolean;
	/** Minori's machines, or null while they're being listed or if Minori isn't there. */
	machines: Machine[] | null;
	machinesProblem: string | null;
}

/** Whether a kind of thing can be shown, and if not, why, in words for the person choosing. */
export type Availability = { ok: true } | { ok: false; checking: boolean; reason: string };

const OK: Availability = { ok: true };

export function availability(setup: Setup, phone: Capabilities): Availability {
	const no = (reason: string, checking = false): Availability => ({ ok: false, checking, reason });
	const machines = (need: (machine: Machine) => boolean, missing: string): Availability => {
		if (!phone.minoriInstalled) return no("Needs Minori, the virtual machine app, on the phone.");
		if (phone.machinesProblem) return no(phone.machinesProblem);
		if (phone.machines === null) return no("Asking Minori for its machines.", true);
		if (phone.machines.length === 0) return no("Minori has no machines yet. Make one in Minori first.");
		return phone.machines.some(need) ? OK : no(missing);
	};
	switch (setup) {
		case "android-desktop":
			if (!phone.desktopChecked) return no("Checking whether this phone can make a desktop.", true);
			return phone.desktopProblem ? no(phone.desktopProblem) : OK;
		case "android-screen":
		case "android-app":
			return OK;
		case "linux-app": {
			if (phone.airiInstalled) return OK;
			return no("Needs Airi, which runs Linux apps on Android, on the phone.");
		}
		case "linux-desktop":
			return machines(
				(machine) => machine.agent,
				"None of Minori's machines has its guest agent, which a desktop needs. Its console still works.",
			);
		case "linux-console":
			return machines(() => true, "");
	}
}

/** The machines a Linux desktop or console can come from. */
export function machinesFor(setup: "linux-desktop" | "linux-console", machines: Machine[]): Machine[] {
	return setup === "linux-desktop" ? machines.filter((machine) => machine.agent) : machines;
}
