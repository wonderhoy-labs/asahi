// What the tab can show, and how Shinonome is asked for the ones it draws.

import type { SessionMode } from "@wonderhoy-labs/shinonome";

/**
 * What the tab shows. The Pixel's desktop, its own screen and one app alone come through Shinonome, on the same canvas;
 * a Minori machine's desktop or console comes through Minori.
 */
export type Source =
	| { kind: "pixel" }
	| { kind: "screen" }
	| { kind: "app"; app: string; name: string }
	| { kind: "machine"; vm: string; name: string; view: "desktop" | "console" };

export type MachineSource = Extract<Source, { kind: "machine" }>;

/** What Shinonome's server has to show for a source, or null for a Minori machine. */
export function shinonomeMode(source: Source): SessionMode | null {
	switch (source.kind) {
		case "pixel":
			return { kind: "desktop" };
		case "screen":
			return { kind: "mirror" };
		case "app":
			return { kind: "app", app: source.app };
		case "machine":
			return null;
	}
}

/** What the source menu's button says. */
export function sourceLabel(source: Source): string {
	switch (source.kind) {
		case "pixel":
			return "Pixel desktop";
		case "screen":
			return "Pixel screen";
		case "app":
			return source.name;
		case "machine":
			return `${source.name} ${source.view === "desktop" ? "desktop" : "console"}`;
	}
}
