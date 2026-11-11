import { describe, expect, it } from "vitest";
import { airiLink, machineAppLink, parseLinuxApps } from "./airi";

describe("Airi's apps", () => {
	it("reads the provider's rows, names last", () => {
		const output = [
			"Row: 0 desktop_id=org.gnome.Calculator.desktop, on_launcher=1, name=Calculator",
			"Row: 1 desktop_id=foot.desktop, on_launcher=0, name=Foot, a terminal, on_launcher=1",
			"",
		].join("\n");
		expect(parseLinuxApps(output)).toEqual([
			{ desktopId: "org.gnome.Calculator.desktop", onLauncher: true, name: "Calculator" },
			{ desktopId: "foot.desktop", onLauncher: false, name: "Foot, a terminal, on_launcher=1" },
		]);
	});

	it("finds nothing in an empty answer", () => {
		expect(parseLinuxApps("No result found.\n")).toEqual([]);
	});

	it("makes the links", () => {
		expect(airiLink("foot.desktop")).toBe("airi://app/foot.desktop");
		expect(machineAppLink("fec9d22a", "foot.desktop")).toBe("minori://vm/fec9d22a/app/foot.desktop");
	});
});
