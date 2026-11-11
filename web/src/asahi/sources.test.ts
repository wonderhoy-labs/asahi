import { describe, expect, it } from "vitest";
import type { Machine } from "./minori";
import { availability, type Capabilities, parseSource, setupOf, shinonomeMode, sourceLabel } from "./sources";

const machine = (id: string, agent: boolean): Machine =>
	({ id, name: id, agent, state: "stopped", airi: false }) as unknown as Machine;

const phone = (changes: Partial<Capabilities> = {}): Capabilities => ({
	desktopChecked: true,
	desktopProblem: null,
	airiInstalled: false,
	minoriInstalled: false,
	machines: null,
	machinesProblem: null,
	...changes,
});

describe("sources", () => {
	it("asks Shinonome for the right thing", () => {
		expect(shinonomeMode({ kind: "desktop" })).toEqual({ kind: "desktop" });
		expect(shinonomeMode({ kind: "screen" })).toEqual({ kind: "mirror" });
		expect(shinonomeMode({ kind: "linux-app", app: "airi://app/foot.desktop", name: "Foot" })).toEqual({
			kind: "app",
			app: "airi://app/foot.desktop",
		});
		expect(shinonomeMode({ kind: "android-app", component: "com.example/.Main", name: "Example" })).toEqual({
			kind: "app",
			app: "com.example/.Main",
		});
		expect(shinonomeMode({ kind: "machine", vm: "a", name: "KDE", view: "desktop" })).toBeNull();
	});

	it("names them", () => {
		expect(sourceLabel({ kind: "screen" })).toBe("Android screen");
		expect(sourceLabel({ kind: "linux-app", app: "x", name: "Foot" })).toBe("Foot");
		expect(sourceLabel({ kind: "machine", vm: "a", name: "KDE", view: "console" })).toBe("KDE console");
		expect(setupOf({ kind: "machine", vm: "a", name: "KDE", view: "console" })).toBe("linux-console");
	});

	it("reads back a stored choice, and nothing else", () => {
		const source = { kind: "android-app", component: "com.example/.Main", name: "Example" } as const;
		expect(parseSource(JSON.stringify(source))).toEqual(source);
		expect(parseSource(JSON.stringify({ kind: "machine", vm: "a", name: "KDE", view: "desktop" }))).toEqual({
			kind: "machine",
			vm: "a",
			name: "KDE",
			view: "desktop",
		});
		expect(parseSource('{"kind":"pixel"}')).toBeNull();
		expect(parseSource('{"kind":"android-app","name":"x"}')).toBeNull();
		expect(parseSource("not json")).toBeNull();
	});
});

describe("availability", () => {
	it("offers the desktop once the phone says it can make one", () => {
		expect(availability("android-desktop", phone({ desktopChecked: false }))).toMatchObject({ checking: true });
		expect(availability("android-desktop", phone({ desktopProblem: "No desktop windows." }))).toEqual({
			ok: false,
			checking: false,
			reason: "No desktop windows.",
		});
		expect(availability("android-desktop", phone())).toEqual({ ok: true });
		expect(availability("android-screen", phone({ desktopProblem: "No." }))).toEqual({ ok: true });
	});

	it("needs Airi for Linux apps, and Minori's machines for their desktops and consoles", () => {
		expect(availability("linux-app", phone()).ok).toBe(false);
		expect(availability("linux-app", phone({ airiInstalled: true })).ok).toBe(true);
		expect(availability("linux-console", phone()).ok).toBe(false);
		expect(availability("linux-console", phone({ minoriInstalled: true }))).toMatchObject({ checking: true });
		expect(availability("linux-console", phone({ minoriInstalled: true, machines: [] })).ok).toBe(false);
		const consoleOnly = phone({ minoriInstalled: true, machines: [machine("a", false)] });
		expect(availability("linux-console", consoleOnly).ok).toBe(true);
		expect(availability("linux-desktop", consoleOnly).ok).toBe(false);
		expect(availability("linux-desktop", phone({ minoriInstalled: true, machines: [machine("b", true)] })).ok).toBe(
			true,
		);
	});
});
