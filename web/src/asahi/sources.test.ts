import { describe, expect, it } from "vitest";
import { shinonomeMode, sourceLabel } from "./sources";

describe("sources", () => {
	it("asks Shinonome for the right thing", () => {
		expect(shinonomeMode({ kind: "pixel" })).toEqual({ kind: "desktop" });
		expect(shinonomeMode({ kind: "screen" })).toEqual({ kind: "mirror" });
		expect(shinonomeMode({ kind: "app", app: "airi://app/foot.desktop", name: "Foot" })).toEqual({
			kind: "app",
			app: "airi://app/foot.desktop",
		});
		expect(shinonomeMode({ kind: "machine", vm: "a", name: "KDE", view: "desktop" })).toBeNull();
	});

	it("names them", () => {
		expect(sourceLabel({ kind: "screen" })).toBe("Pixel screen");
		expect(sourceLabel({ kind: "app", app: "x", name: "Foot" })).toBe("Foot");
		expect(sourceLabel({ kind: "machine", vm: "a", name: "KDE", view: "console" })).toBe("KDE console");
	});
});
