import {
	bindInput,
	canvasTarget,
	type Duplex,
	type Machine,
	Minori,
	MinoriError,
	PACKAGE,
	VncClient,
	WAKE_COMMAND,
} from "@wonderhoy-labs/minori";
import { Terminal } from "@xterm/xterm";
import type { Phone } from "../adb/phone";
import type { MachineSource } from "./sources";

export type { Machine };

export type MachineViewState = "starting" | "connecting" | "up" | "ended";

const WAKE_RETRIES = 12;
const WAKE_RETRY_MILLIS = 250;
const START_TIMEOUT_MILLIS = 180_000;
const POLL_MILLIS = 1_000;

function sleep(millis: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, millis));
}

/** Whether Minori is on the phone. Asking doesn't start it, so a phone without Minori sees no change. */
export async function hasMinori(phone: Phone): Promise<boolean> {
	return (await phone.shell(`pm path ${PACKAGE}`)).includes("package:");
}

/** A client for Minori's helper, waking Minori first if it isn't running. */
async function awake(phone: Phone): Promise<Minori> {
	const minori = Minori.overAdb(phone.adb);
	try {
		await minori.hello();
		return minori;
	} catch (error) {
		if (error instanceof MinoriError) throw error;
	}
	await phone.shell(WAKE_COMMAND);
	for (let attempt = 0; ; attempt++) {
		try {
			await minori.hello();
			return minori;
		} catch (error) {
			if (error instanceof MinoriError || attempt >= WAKE_RETRIES) throw error;
			await sleep(WAKE_RETRY_MILLIS);
		}
	}
}

/** Minori's machines, waking Minori first if it isn't running. */
export async function listMachines(phone: Phone): Promise<Machine[]> {
	return (await awake(phone)).list();
}

/** Starts the machine if it isn't running, and waits until it runs and, for a desktop, its VNC server listens. */
async function ready(
	minori: Minori,
	vm: string,
	port: number | null,
	onStatus: (text: string) => void,
	live: () => boolean,
) {
	let machine = (await minori.list()).find((each) => each.id === vm);
	if (!machine) throw new Error("That machine isn't in Minori any more.");
	if (machine.state === "stopped" || machine.state === "error") {
		onStatus(`Starting ${machine.name}.`);
		machine = await minori.start(vm);
	}
	const deadline = Date.now() + START_TIMEOUT_MILLIS;
	for (;;) {
		if (!live()) return;
		machine = (await minori.list()).find((each) => each.id === vm) ?? machine;
		if (machine.state === "error") throw new Error(`${machine.name} couldn't start. Minori on the phone says why.`);
		if (machine.state === "running") {
			if (port === null) return;
			const listening = (await minori.ports(vm)).listening;
			// Without an agent Minori can't tell; then just try.
			if (!listening || listening.includes(port)) return;
			onStatus(`Waiting for ${machine.name}'s desktop. The first boot installs it, which takes a while.`);
		}
		if (Date.now() > deadline) throw new Error(`${machine.name} took too long to be ready.`);
		await sleep(POLL_MILLIS);
	}
}

/** The port Airi's agent listens on in a machine Minori set Airi up in. */
const AIRI_PORT = 47821;

/**
 * Starts a machine Airi is set up in, if it isn't running, and waits for Airi's agent in it. Airi then lists that
 * machine's apps.
 */
export async function readyForAiri(phone: Phone, vm: string, onStatus: (text: string) => void, live: () => boolean) {
	await ready(await awake(phone), vm, AIRI_PORT, onStatus, live);
}

export interface MachineViewEvents {
	onState(state: MachineViewState, message: string | null): void;
}

/** One machine's desktop or console in the tab, for as long as it's shown. */
export class MachineView {
	private alive = true;
	private client: VncClient | null = null;
	private stream: Duplex | null = null;
	private terminal: Terminal | null = null;
	private unbind: (() => void) | null = null;

	constructor(
		private readonly phone: Phone,
		private readonly source: MachineSource,
		private readonly events: MachineViewEvents,
	) {}

	private fail(error: unknown) {
		if (!this.alive) return;
		this.events.onState("ended", error instanceof Error ? error.message : String(error));
	}

	/** Shows the machine's desktop on [canvas]. */
	async showDesktop(canvas: HTMLCanvasElement) {
		const { vm } = this.source;
		try {
			this.events.onState("starting", null);
			const minori = await awake(this.phone);
			const desktop = await minori.desktop(vm);
			await ready(
				minori,
				vm,
				desktop.port,
				(text) => this.events.onState("starting", text),
				() => this.alive,
			);
			if (!this.alive) return;
			this.events.onState("connecting", null);
			const stream = await minori.connect(vm, desktop.port);
			const client = await VncClient.connect(stream, canvasTarget(canvas), desktop.password, {
				onClose: (error) => this.fail(error ?? new Error(`${this.source.name}'s desktop closed.`)),
			});
			if (!this.alive) {
				await client.close();
				return;
			}
			this.client = client;
			this.unbind = bindInput(canvas, client);
			canvas.focus();
			this.events.onState("up", null);
		} catch (error) {
			this.fail(error);
		}
	}

	/** Shows the machine's console in [element]. */
	async showConsole(element: HTMLElement) {
		const { vm } = this.source;
		const terminal = new Terminal({
			fontFamily: "ui-monospace, 'Cascadia Mono', Menlo, monospace",
			fontSize: 15,
			theme: { background: "#000000" },
			cursorBlink: true,
		});
		this.terminal = terminal;
		terminal.open(element);
		try {
			this.events.onState("starting", null);
			const minori = await awake(this.phone);
			await ready(
				minori,
				vm,
				null,
				(text) => this.events.onState("starting", text),
				() => this.alive,
			);
			if (!this.alive) return;
			const stream = await minori.console(vm);
			this.stream = stream;
			const writer = stream.writable.getWriter();
			const encoder = new TextEncoder();
			terminal.onData((data) => void writer.write(encoder.encode(data)).catch(() => undefined));
			this.events.onState("up", null);
			terminal.focus();
			// A serial console prints nothing until it's asked, so ask for a prompt.
			void writer.write(encoder.encode("\r"));
			const reader = stream.readable.getReader();
			for (;;) {
				const { value, done } = await reader.read();
				if (done || !value) break;
				terminal.write(value);
			}
			this.fail(new Error(`${this.source.name}'s console closed.`));
		} catch (error) {
			this.fail(error);
		}
	}

	close() {
		this.alive = false;
		this.unbind?.();
		void this.client?.close();
		void Promise.resolve(this.stream?.close()).catch(() => undefined);
		this.terminal?.dispose();
	}
}

export { MinoriError };
