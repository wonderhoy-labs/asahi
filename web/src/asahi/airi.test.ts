import { describe, expect, it } from "vitest";
import { airiLink, linuxAppIconUri, machineAppLink, machineSource, parseLinuxApps } from "./airi";

describe("Airi's apps", () => {
	it("reads Airi 0.3.0's rows, names last", () => {
		const output = [
			"Row: 0 desktop_id=org.gnome.Calculator.desktop, on_launcher=1, name=Calculator",
			"Row: 1 desktop_id=foot.desktop, on_launcher=0, name=Foot, a terminal, on_launcher=1",
			"",
		].join("\n");
		expect(parseLinuxApps(output)).toEqual([
			{ desktopId: "org.gnome.Calculator.desktop", onLauncher: true, name: "Calculator", source: "terminal" },
			{
				desktopId: "foot.desktop",
				onLauncher: false,
				name: "Foot, a terminal, on_launcher=1",
				source: "terminal",
			},
		]);
	});

	it("reads the source Airi 0.4.0 puts after the name", () => {
		const vm = "1d0c6a5e-7a11-4c3e-9f00-00000000a001";
		const output = [
			"Row: 0 desktop_id=foot.desktop, on_launcher=0, name=Foot, source=terminal",
			`Row: 1 desktop_id=org.gnome.Calculator.desktop, on_launcher=1, name=Calculator, source=minori:${vm}`,
			`Row: 2 desktop_id=odd.desktop, on_launcher=0, name=Odd, source=terminal, source=x, source=minori:${vm}`,
		].join("\n");
		expect(parseLinuxApps(output)).toEqual([
			{ desktopId: "foot.desktop", onLauncher: false, name: "Foot", source: "terminal" },
			{
				desktopId: "org.gnome.Calculator.desktop",
				onLauncher: true,
				name: "Calculator",
				source: machineSource(vm),
			},
			{
				desktopId: "odd.desktop",
				onLauncher: false,
				name: "Odd, source=terminal, source=x",
				source: machineSource(vm),
			},
		]);
	});

	it("finds nothing in an empty answer", () => {
		expect(parseLinuxApps("No result found.\n")).toEqual([]);
	});

	it("makes the links", () => {
		expect(airiLink("foot.desktop")).toBe("airi://app/foot.desktop");
		expect(machineAppLink("fec9d22a", "foot.desktop")).toBe("minori://vm/fec9d22a/app/foot.desktop");
		expect(machineSource("fec9d22a")).toBe("minori:fec9d22a");
	});
});

describe("linuxAppIconUri", () => {
	it("leaves out the source for the terminal, which every Airi knows", () => {
		expect(linuxAppIconUri({ desktopId: "org.gnome.Calculator.desktop", source: "terminal" })).toBe(
			"content://com.wonderhoylabs.airi.apps/icon/org.gnome.Calculator.desktop",
		);
	});
	it("names a Minori machine's source", () => {
		expect(linuxAppIconUri({ desktopId: "firefox-esr.desktop", source: "minori:ab5f" })).toBe(
			"content://com.wonderhoylabs.airi.apps/icon/firefox-esr.desktop?source=minori%3Aab5f",
		);
	});
});
