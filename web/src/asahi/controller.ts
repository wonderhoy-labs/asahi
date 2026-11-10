import {
	DesktopSession,
	type DesktopStatus,
	exposeDebugApi,
	runDesktopLink,
	type SessionStats,
	type SoundState,
} from "@wonderhoy-labs/shinonome";
import shinonomeApkUrl from "@wonderhoy-labs/shinonome/shinonome.apk?url";
import {
	type AppInfo,
	connectWisp,
	InstallError,
	type LinkState,
	LogStore,
	normalizeServerUrl,
	ShiraLink,
	type StopReason,
	type WispCredentials,
	WispError,
} from "@wonderhoy-labs/shira";
import shiraApkUrl from "@wonderhoy-labs/shira/shira.apk?url";
import type { AdbSocket } from "@yume-chan/adb";
import type { AdbDaemonWebUsbDevice } from "@yume-chan/adb-daemon-webusb";
import type { Phone, PhoneKind } from "../adb/phone";
import { authorizeUsb, claimUsb, knownPhone, pickPhone, UsbBusyError, type UsbConnection } from "../adb/usb";
import { hasMinori, listMachines, type Machine, MachineView, type MachineViewState, type Source } from "./minori";

/** The onboarding, in order, and then the session itself. */
export type Step = "usb" | "authorize" | "server" | "app" | "launch" | "live";
export const SETUP_STEPS: Step[] = ["usb", "authorize", "server", "app", "launch"];

export type NetworkState = "off" | "starting" | "connecting" | "up" | "server-lost" | "phone-lost";
export type DesktopState = "off" | "starting" | "connecting" | "up" | "unavailable" | "ended" | "phone-lost";
export type LaunchStage = "network" | "desktop";

export interface AsahiState {
	step: Step;
	/** The USB device that's been picked, before adb has let us in. */
	usbDevice: string | null;
	/** The phone's name once adb has let us in. */
	phone: string | null;
	phoneKind: PhoneKind | null;

	serverInput: string;
	username: string;
	/** Show the login fields, because the server asked or someone asked for them. */
	loginNeeded: boolean;
	serverLabel: string | null;
	serverMessage: string | null;
	checkingServer: boolean;
	recentServers: string[];

	app: AppInfo | null;
	/** True if the version of Shira's app on the phone is what this site carries, or newer. */
	appCurrent: boolean;
	checkingApp: boolean;
	installing: boolean;
	installProgress: number;
	installManually: boolean;
	/** The install failed in a way that only removing the old copy can fix. */
	offerUninstall: boolean;

	/** What the Launch step is doing right now, if anything. */
	launchStage: LaunchStage | null;
	network: NetworkState;
	/** The app's version, once it's said hello. */
	appVersion: string | null;
	udp: boolean;
	wispVersion: number | null;

	desktop: DesktopState;
	/** Why there's no desktop, when the phone can't make one or the server wouldn't start. */
	desktopProblem: string | null;
	desktopStatus: DesktopStatus | null;
	desktopStats: SessionStats | null;
	hasPicture: boolean;
	sound: SoundState;
	/** The desktop at the phone's density, for apps such as Discord, at a little more latency. Remembered. */
	sharp: boolean;
	/** Apps someone said not now to sharp mode for. */
	sharpDeclined: ReadonlySet<string>;
	/** A file dropped on the desktop, on its way to the phone. */
	transfer: { name: string; percent: number } | null;
	/** What happened to the last one. */
	transferNote: string | null;

	/** What the tab shows: the Pixel's desktop, unless someone picked a Minori machine. */
	source: Source;
	/** Whether Minori is on the phone. Without it there's nothing to pick, and the page looks as it always did. */
	minoriInstalled: boolean;
	/** Minori's machines, once someone opened the menu. */
	machines: Machine[] | null;
	machinesProblem: string | null;
	/** How the picked machine's desktop or console is doing, and why it ended. */
	machineView: MachineViewState | null;
	machineMessage: string | null;
	/** Bumps to open the machine's view again. */
	machineAttempt: number;

	/** What to tell the person to do while something's happening. */
	busy: string | null;
	error: string | null;
	notice: string | null;
}

const STORED_SERVER = "asahi.server";
const STORED_SERVERS = "asahi.servers";
const STORED_USERNAME = "asahi.username";
/** "off" keeps the phone's sound on the phone. */
const STORED_SOUND = "asahi.sound";
/** "on" gives the desktop the phone's density. */
const STORED_SHARP = "asahi.sharp";
/** Development only: extra options for the desktop server, such as --screen-on. */
const STORED_DEV_DESKTOP_ARGS = "asahi.dev.desktop-args";
const MAX_RECENT_SERVERS = 4;

const POLL_MILLIS = 1_000;
const TRANSFER_NOTE_MILLIS = 4_000;
const RECONNECT_MILLIS = 1_000;
// Unplugging ends a link too, and that's handled when adb notices, a moment later.
const LINK_SETTLE_MILLIS = 300;
// Long enough for the last messages to reach the phone before USB closes.
const RELEASE_DELAY_MILLIS = 500;
// How long a phone takes to reset its USB after a browser holding it goes away without saying so.
const USB_RESET_MILLIS = 1_500;

function stored(key: string): string {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

function store(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Without storage it's just asked for again next time.
	}
}

function storedServers(): string[] {
	try {
		const list = JSON.parse(stored(STORED_SERVERS) || "[]") as unknown;
		return Array.isArray(list)
			? list.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT_SERVERS)
			: [];
	} catch {
		return [];
	}
}

function defaultServer(): string {
	if (import.meta.env.DEV) {
		const scheme = location.protocol === "https:" ? "wss:" : "ws:";
		return `${scheme}//${location.host}/wisp/`;
	}
	return stored(STORED_SERVER);
}

function devDesktopArgs(): string[] {
	if (!import.meta.env.DEV) return [];
	return stored(STORED_DEV_DESKTOP_ARGS).split(/\s+/).filter(Boolean);
}

const sleep = (millis: number) => new Promise<void>((resolve) => setTimeout(resolve, millis));

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** What the page calls each of the link's states. */
const NETWORK_STATES: Record<LinkState, NetworkState> = {
	idle: "off",
	"waiting-for-app": "starting",
	connecting: "connecting",
	live: "up",
	"server-lost": "server-lost",
};

/** The network stopped by itself, before or after it was first up. */
class NetworkStopped extends Error {
	constructor(readonly reason: StopReason) {
		super(
			reason.kind === "off"
				? "The network stopped on your phone."
				: reason.kind === "replaced"
					? "Another page took over your phone's network."
					: reason.message,
		);
		this.name = "NetworkStopped";
	}
}

/** The reason a desktop server gave for not starting, if it gave one. */
function serverIncompatibility(log: string): string | null {
	return /^incompatible: (.*)$/m.exec(log)?.[1]?.trim() ?? null;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`This site is missing ${url}.`);
	return new Uint8Array(await response.arrayBuffer());
}

/** Everything the page does, step by step. The screens only show this and call its methods. */
export class Controller {
	readonly log = new LogStore();

	private state: AsahiState = {
		step: "usb",
		usbDevice: null,
		phone: null,
		phoneKind: null,
		serverInput: defaultServer(),
		username: stored(STORED_USERNAME),
		loginNeeded: false,
		serverLabel: null,
		serverMessage: null,
		checkingServer: false,
		recentServers: storedServers(),
		app: null,
		appCurrent: false,
		checkingApp: false,
		installing: false,
		installProgress: 0,
		installManually: false,
		offerUninstall: false,
		launchStage: null,
		network: "off",
		appVersion: null,
		udp: false,
		wispVersion: null,
		desktop: "off",
		desktopProblem: null,
		desktopStatus: null,
		desktopStats: null,
		hasPicture: false,
		sound: "off",
		sharp: stored(STORED_SHARP) === "on",
		sharpDeclined: new Set(),
		transfer: null,
		transferNote: null,
		source: { kind: "pixel" },
		minoriInstalled: false,
		machines: null,
		machinesProblem: null,
		machineView: null,
		machineMessage: null,
		machineAttempt: 0,
		busy: null,
		error: null,
		notice: null,
	};

	private readonly listeners = new Set<() => void>();
	private phone: Phone | null = null;
	/** The device being authorized, so that waiting for the phone's OK can be called off. */
	private pendingDevice: AdbDaemonWebUsbDevice | null = null;
	private usingUsb = false;
	private shiraApk: Uint8Array<ArrayBuffer> | null = null;
	private shinonomeApk: Uint8Array<ArrayBuffer> | null = null;
	/** Bumped to cancel whatever setup job is going on. Each one checks it's still current. */
	private job = 0;

	// The network, through Shira's app
	private link: ShiraLink | null = null;
	private serverUrl: string | null = null;
	private credentials: WispCredentials | null = null;

	// The desktop
	private session: DesktopSession | null = null;
	private desktopSocket: AdbSocket | null = null;
	private desktopJob = 0;
	private transferNoteTimer: ReturnType<typeof setTimeout> | undefined;
	private sending = false;
	private machine: MachineView | null = null;
	private desktopOpening: Promise<void> = Promise.resolve();

	constructor() {
		navigator.usb?.addEventListener("connect", () => void this.onUsbPlugged());
		// The phone's told by its sockets closing, if this gets to run. If it doesn't, the pings stop.
		window.addEventListener("pagehide", () => void this.phone?.close().catch(() => undefined));
		exposeDebugApi(
			() => this.session,
			import.meta.env.DEV ? (command) => this.requirePhone().shell(command) : undefined,
			"asahi",
		);
	}

	readonly subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly getState = () => this.state;

	private update(changes: Partial<AsahiState>) {
		this.state = { ...this.state, ...changes };
		for (const listener of this.listeners) listener();
	}

	dismissError() {
		this.update({ error: null });
	}

	dismissNotice() {
		this.update({ notice: null });
	}

	private requirePhone(): Phone {
		if (!this.phone) throw new Error("The phone was disconnected.");
		return this.phone;
	}

	// Steps 1 and 2: USB, then adb's OK

	/** Has to be called straight from a click, because of the browser's list of devices. */
	async connectUsb() {
		this.update({ error: null, notice: null });
		try {
			const device = (await knownPhone()) ?? (await pickPhone());
			if (!device) return;
			this.usingUsb = true;
			await this.attachUsb(device);
		} catch (error) {
			if (error instanceof CancelledError) return;
			if (this.state.step === "authorize") this.update({ step: "usb", usbDevice: null });
			this.update({ busy: null, error: `Couldn't reach your phone: ${message(error)}` });
		}
	}

	/** Tries once more if USB failed, because a phone resets it just after a browser crashes or is closed. */
	private async attachUsb(device: AdbDaemonWebUsbDevice) {
		try {
			await this.attachDevice(device);
		} catch (error) {
			if (error instanceof UsbBusyError || error instanceof CancelledError) throw error;
			console.info("retrying after a USB failure", error);
			await sleep(USB_RESET_MILLIS);
			const again = await knownPhone();
			if (!again) throw error;
			await this.attachDevice(again);
		}
	}

	private async attachDevice(device: AdbDaemonWebUsbDevice) {
		const job = ++this.job;
		const connection: UsbConnection = await claimUsb(device);
		if (job !== this.job) throw new CancelledError();
		this.pendingDevice = device;
		const resuming = this.state.step === "live";
		if (!resuming) this.update({ step: "authorize", usbDevice: device.name || "Your phone" });
		this.update({ busy: resuming ? "Reconnecting to your phone." : null });
		let phone: Phone;
		try {
			phone = await authorizeUsb(device, connection);
		} catch (error) {
			// Calling it off closes USB, which is what ends the wait.
			if (job !== this.job) throw new CancelledError();
			throw error;
		} finally {
			if (this.pendingDevice === device) this.pendingDevice = null;
		}
		if (job !== this.job) {
			void phone.close().catch(() => undefined);
			throw new CancelledError();
		}
		await this.attach(phone);
	}

	/** Stops waiting for the phone's OK, and lets go of USB. */
	cancelAuthorize() {
		this.job++;
		const device = this.pendingDevice;
		this.pendingDevice = null;
		void device?.raw.close().catch(() => undefined);
		this.update({ step: "usb", usbDevice: null, busy: null });
	}

	/** Development only: uses a phone or emulator through the adb server, which has already let us in. */
	async connectThroughAdbServer(device: import("../adb/dev-server").DevDevice) {
		if (!import.meta.env.DEV) return;
		this.update({ error: null, notice: null });
		try {
			const { openDevPhone } = await import("../adb/dev-server");
			this.usingUsb = false;
			this.update({ usbDevice: device.label });
			await this.attach(await openDevPhone(device));
		} catch (error) {
			this.update({ busy: null, error: `Couldn't reach that device: ${message(error)}` });
		}
	}

	private async onUsbPlugged() {
		// Only to carry on after a replug. The first connection is always someone's click.
		if (!this.usingUsb || this.phone || this.state.step !== "live") return;
		try {
			const device = await knownPhone();
			if (device && !this.phone) await this.attachUsb(device);
		} catch (error) {
			this.update({ busy: null, error: `Couldn't reach your phone: ${message(error)}` });
		}
	}

	private async attach(phone: Phone) {
		this.phone = phone;
		const lost = () => this.onPhoneLost(phone);
		phone.disconnected.then(lost, lost);
		this.update({ phone: phone.name, phoneKind: phone.kind, busy: null, error: null });
		void hasMinori(phone).then(
			(minoriInstalled) => {
				if (this.phone === phone) this.update({ minoriInstalled });
			},
			(error: unknown) => console.info("couldn't look for Minori", error),
		);
		void phone.network.packagesByUid().then(
			(packages) => {
				this.log.packages = packages;
			},
			(error: unknown) => console.warn("couldn't list the phone's packages", error),
		);
		try {
			await this.refreshApp();
		} catch (error) {
			this.phone = null;
			void phone.close().catch(() => undefined);
			throw error;
		}
		if (this.state.step === "live") {
			await this.resume(phone);
			return;
		}
		this.update({ step: "server" });
	}

	/** Picks the session back up after the cable comes out and goes back in. */
	private async resume(phone: Phone) {
		if (this.state.network === "phone-lost" && this.state.appCurrent)
			void this.runNetwork(true).catch(() => undefined);
		if (this.state.desktop === "phone-lost") {
			if (await phone.desktop.isServerRunning()) {
				this.update({ desktop: "connecting" });
				void this.openDesktopLink();
			} else {
				this.update({ desktop: "ended", notice: "The desktop ended while your phone was unplugged." });
			}
		}
	}

	private onPhoneLost(phone: Phone) {
		if (this.phone !== phone) return;
		this.phone = null;
		this.job++;
		this.closeMachine();
		if (this.state.step === "live") {
			this.desktopJob++;
			this.stopNetwork();
			this.desktopSocket = null;
			this.session?.detach();
			const desktopWasOn = ["up", "connecting", "starting"].includes(this.state.desktop);
			this.update({
				phone: null,
				busy: null,
				network: this.state.network === "off" ? "off" : "phone-lost",
				desktop: desktopWasOn ? "phone-lost" : this.state.desktop,
			});
			return;
		}
		this.stopNetwork();
		this.update({
			step: "usb",
			phone: null,
			usbDevice: null,
			installing: false,
			installManually: false,
			launchStage: null,
			network: "off",
			desktop: "off",
			busy: null,
		});
	}

	// Step 3: the Wisp server

	setServerInput(serverInput: string) {
		this.update({ serverInput, error: null });
	}

	setUsername(username: string) {
		this.update({ username });
	}

	showLogin() {
		this.update({ loginNeeded: true });
	}

	/** Checks the address really is a Wisp server that'll have us, by connecting to it. */
	async chooseServer(password: string) {
		const normalized = normalizeServerUrl(this.state.serverInput);
		if ("problem" in normalized) {
			this.update({ error: normalized.problem });
			return;
		}
		const username = this.state.username.trim();
		const credentials = this.state.loginNeeded && username ? { username, password } : null;
		this.update({ checkingServer: true, error: null, serverInput: normalized.url });
		try {
			const connection = await connectWisp(normalized.url, credentials);
			this.update({
				udp: connection.udp_enabled,
				wispVersion: connection.wisp_version,
				serverMessage: connection.server_motd ?? null,
			});
			connection.onclose = () => undefined;
			connection.close();

			this.serverUrl = normalized.url;
			this.credentials = credentials;
			store(STORED_SERVER, normalized.url);
			if (credentials) store(STORED_USERNAME, credentials.username);
			const recentServers = [
				normalized.url,
				...this.state.recentServers.filter((url) => url !== normalized.url),
			].slice(0, MAX_RECENT_SERVERS);
			store(STORED_SERVERS, JSON.stringify(recentServers));
			this.update({
				checkingServer: false,
				serverLabel: new URL(normalized.url).host,
				recentServers,
				step: "app",
			});
		} catch (error) {
			const needsLogin =
				error instanceof WispError &&
				(error.failure === "credentials-needed" || error.failure === "credentials-wrong");
			this.update({
				checkingServer: false,
				loginNeeded: this.state.loginNeeded || needsLogin,
				error: message(error),
			});
		}
	}

	forgetServer(url: string) {
		const recentServers = this.state.recentServers.filter((item) => item !== url);
		store(STORED_SERVERS, JSON.stringify(recentServers));
		this.update({ recentServers });
	}

	/** Goes back to an earlier step that's already done, to change it. */
	goBack(step: "server" | "app") {
		if (this.state.step === "live" || this.state.launchStage) return;
		const order = SETUP_STEPS.indexOf(step);
		if (order >= SETUP_STEPS.indexOf(this.state.step)) return;
		this.job++;
		this.update({ step, error: null, installManually: false });
	}

	// Step 4: the app. Nothing's installed unless someone asks.

	private appIsCurrent(app: AppInfo) {
		return app.installed && (app.versionCode ?? 0) >= __SHIRA_VERSION_CODE__;
	}

	private async refreshApp(): Promise<AppInfo> {
		const app = await this.requirePhone().network.appInfo();
		this.update({ app, appCurrent: this.appIsCurrent(app) });
		return app;
	}

	/** Looks again at what's on the phone. */
	async checkApp() {
		this.update({ checkingApp: true, error: null });
		try {
			await this.refreshApp();
		} catch (error) {
			this.update({ error: message(error) });
		} finally {
			this.update({ checkingApp: false });
		}
	}

	/** Shira's app, which this site carries. */
	private async fetchShiraApk(): Promise<Uint8Array<ArrayBuffer>> {
		this.shiraApk ??= await fetchBytes(shiraApkUrl);
		return this.shiraApk;
	}

	/** Shinonome's app, which holds the desktop server. It runs from a copy, so it isn't installed. */
	private async fetchShinonomeApk(): Promise<Uint8Array<ArrayBuffer>> {
		this.shinonomeApk ??= await fetchBytes(shinonomeApkUrl);
		return this.shinonomeApk;
	}

	async installApp() {
		this.job++;
		this.update({
			installing: true,
			installProgress: 0,
			installManually: false,
			offerUninstall: false,
			error: null,
			notice: null,
		});
		try {
			await this.requirePhone().network.install(await this.fetchShiraApk(), (installProgress) =>
				this.update({ installProgress }),
			);
			await this.refreshApp();
			this.update({ installing: false });
		} catch (error) {
			const uninstall = error instanceof InstallError && error.needsUninstall;
			this.update({
				installing: false,
				offerUninstall: uninstall,
				error: uninstall
					? "The copy of Shira on your phone was signed with a different key, or is newer, so Android won't replace it. Remove it to carry on."
					: `Couldn't install the app: ${message(error)}`,
			});
		}
	}

	async uninstallAndInstall() {
		try {
			await this.requirePhone().network.uninstall();
			await this.installApp();
		} catch (error) {
			this.update({ error: `Couldn't remove the old app: ${message(error)}` });
		}
	}

	/** Waits for someone to install it themselves, and says so when it appears. */
	async installManually() {
		const job = ++this.job;
		this.update({ installManually: true, error: null, notice: null });
		try {
			while (this.job === job && this.phone) {
				const app = await this.refreshApp();
				if (this.appIsCurrent(app)) {
					this.update({ installManually: false });
					return;
				}
				await sleep(POLL_MILLIS);
			}
		} catch (error) {
			if (this.job === job) this.update({ installManually: false, error: message(error) });
		}
	}

	cancelManualInstall() {
		this.job++;
		this.update({ installManually: false });
	}

	confirmApp() {
		if (!this.state.appCurrent) return;
		this.update({ step: "launch", error: null, notice: null });
	}

	// Step 5: launch

	/** Turns on the network, starts the desktop, and goes to it. */
	async launch() {
		const job = ++this.job;
		this.update({ launchStage: "network", error: null, notice: null, busy: null });
		try {
			await this.runNetwork(true);
			if (job !== this.job) return;
			this.update({ launchStage: "desktop", busy: null });
			await this.prepareDesktop();
			if (job !== this.job) return;
			this.update({ launchStage: null, busy: null, step: "live" });
		} catch (error) {
			if (job !== this.job) return;
			this.stopNetwork();
			if (error instanceof NetworkStopped && error.reason.kind === "app-mismatch") {
				this.update({
					launchStage: null,
					network: "off",
					busy: null,
					step: "app",
					appCurrent: false,
					error: `${error.message} Install the version from this site.`,
				});
				return;
			}
			this.update({ launchStage: null, network: "off", busy: null, error: message(error) });
		}
	}

	cancelLaunch() {
		this.job++;
		this.stopNetwork();
		this.update({ launchStage: null, network: "off", busy: null });
	}

	// The network

	/**
	 * Gets from here to connected through Shira's app, and resolves the first time the VPN's up. It carries on in the
	 * background after that, through a lost server. [startApp] is false when going back to an app that's already
	 * running, because anything else would turn the network back on after someone turned it off.
	 */
	private runNetwork(startApp: boolean): Promise<void> {
		this.stopNetwork();
		const phone = this.requirePhone();
		const serverUrl = this.serverUrl;
		if (!serverUrl) return Promise.reject(new Error("Choose a Wisp server first."));
		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const link = new ShiraLink({
				phone: phone.network,
				serverUrl,
				credentials: this.credentials,
				log: this.log,
				events: {
					onState: (state) => {
						if (this.link !== link) return;
						this.update({ network: NETWORK_STATES[state] });
						if (state === "live" && !settled) {
							settled = true;
							resolve();
						}
					},
					onBusy: (busy) => {
						if (this.link === link) this.update({ busy });
					},
					onHello: (appVersion) => this.update({ appVersion }),
					onServer: ({ udp, wispVersion, message: serverMessage }) =>
						this.update({ udp, wispVersion, serverMessage }),
					onStopped: (reason) => {
						if (this.link !== link) return;
						this.link = null;
						const stopped = new NetworkStopped(reason);
						if (settled) {
							this.update({ network: "off", error: `The network stopped: ${stopped.message}` });
						} else {
							settled = true;
							reject(stopped);
						}
					},
				},
			});
			this.link = link;
			link.start(startApp ? "auto" : "manual");
		});
	}

	/** Turns the network back on from the session, after it was turned off or failed. */
	async restartNetwork() {
		this.update({ error: null });
		try {
			await this.runNetwork(true);
		} catch (error) {
			this.stopNetwork();
			this.update({ network: "off", busy: null, error: message(error) });
		}
	}

	/** Lets go of the network link without turning Shira off on the phone. */
	private stopNetwork() {
		const link = this.link;
		this.link = null;
		link?.stop();
	}

	// The desktop

	/** Starts the server, or finds the one that's already running. A phone that can't do it just says why. */
	private async prepareDesktop() {
		this.update({ desktop: "starting", desktopProblem: null, desktopStatus: null, hasPicture: false });
		try {
			const phone = this.requirePhone();
			if (await phone.desktop.isServerRunning()) {
				this.update({ desktop: "connecting" });
				return;
			}
			const output = await phone.desktop.startServer(await this.fetchShinonomeApk(), devDesktopArgs());
			const problem = serverIncompatibility(output);
			if (problem) {
				this.update({ desktop: "unavailable", desktopProblem: problem });
				return;
			}
			if (!(await phone.desktop.isServerRunning())) {
				throw new Error(`The desktop didn't start. The phone said:\n\n${output.trim().slice(-600)}`);
			}
			this.update({ desktop: "connecting" });
		} catch (error) {
			this.update({ desktop: "unavailable", desktopProblem: message(error) });
		}
	}

	/** Starts the desktop again from the session, after it ended or failed. */
	async restartDesktop() {
		this.update({ error: null, notice: null });
		await this.prepareDesktop();
		if (this.state.desktop === "connecting") void this.openDesktopLink();
	}

	/** The desktop's screen hands over its canvas when it appears. */
	attachCanvas(canvas: HTMLCanvasElement) {
		this.session?.dispose();
		this.session = new DesktopSession(canvas, {
			onStatus: (desktopStatus) => this.update({ desktopStatus }),
			onStats: (desktopStats) => this.update({ desktopStats }),
			onFirstFrame: () => this.update({ hasPicture: true }),
			onAuthenticated: () => this.update({ desktop: "up" }),
			onReplaced: () =>
				this.endDesktopLink("Another window took over the desktop. Start it here to take it back."),
			onSound: (sound) => this.update({ sound }),
		});
		this.session.setSound(stored(STORED_SOUND) !== "off");
		// Read again here, so a choice made in another tab applies too.
		const sharp = stored(STORED_SHARP) === "on";
		this.update({ sharp });
		this.session.setSharp(sharp);
		if (this.state.desktop === "connecting") void this.openDesktopLink();
	}

	toggleSharp() {
		this.setSharp(!this.state.sharp);
	}

	/** Turning it on restarts the desktop's apps that need it, which Shinonome's server does. */
	setSharp(sharp: boolean) {
		store(STORED_SHARP, sharp ? "on" : "off");
		this.update({ sharp });
		this.session?.setSharp(sharp);
	}

	/** Not now, for the app that wanted sharp mode. It won't ask about that app again until the page reloads. */
	declineSharp(app: string) {
		this.update({ sharpDeclined: new Set([...this.state.sharpDeclined, app]) });
	}

	/** Moves the phone's sound here, or back to the phone. From a click, which browsers need before playing sound. */
	toggleSound() {
		const { sound } = this.state;
		const on = sound === "off" || sound === "needs-click";
		store(STORED_SOUND, on ? "on" : "off");
		this.session?.setSound(on);
	}

	/** Copies files dropped on the desktop into the phone's Downloads, one at a time. */
	async saveToPhone(files: File[]) {
		const phone = this.phone;
		if (!phone || files.length === 0 || this.sending) {
			return;
		}
		this.sending = true;
		const saved: string[] = [];
		let failure: string | null = null;
		for (const file of files) {
			this.update({ transfer: { name: file.name, percent: 0 } });
			try {
				saved.push(
					await phone.desktop.saveToDownloads(file, (fraction) => {
						const percent = Math.floor(fraction * 100);
						if (percent !== this.state.transfer?.percent) {
							this.update({ transfer: { name: file.name, percent } });
						}
					}),
				);
			} catch (error) {
				failure = `Couldn't send ${file.name} to your phone: ${message(error)}`;
				break;
			}
		}
		this.sending = false;
		const note =
			failure ??
			(saved.length === 1
				? `Saved ${saved[0]} in your phone's Downloads.`
				: `Saved ${saved.length} files in your phone's Downloads.`);
		this.update({ transfer: null, transferNote: note });
		clearTimeout(this.transferNoteTimer);
		this.transferNoteTimer = setTimeout(() => this.update({ transferNote: null }), TRANSFER_NOTE_MILLIS);
	}

	releaseCanvas() {
		this.desktopJob++;
		void this.desktopSocket?.close();
		this.desktopSocket = null;
		this.session?.dispose();
		this.session = null;
	}

	private async openDesktopLink() {
		const job = ++this.desktopJob;
		const { phone, session } = this;
		if (!phone || !session) return;
		this.update({ desktop: "connecting" });
		// One at a time. The server hands the desktop to whichever connection arrives last, so a stale one
		// that's still on its way could otherwise take it from this one.
		const previous = this.desktopOpening;
		let opened: () => void = () => undefined;
		this.desktopOpening = new Promise<void>((resolve) => (opened = resolve));
		let socket: AdbSocket;
		try {
			await previous;
			if (job !== this.desktopJob) return;
			socket = await phone.desktop.openDesktopSocket();
		} catch (error) {
			console.warn("couldn't open the desktop's socket", error);
			if (job === this.desktopJob) void this.onDesktopLinkEnded(phone);
			return;
		} finally {
			opened();
		}
		if (job !== this.desktopJob) {
			void socket.close();
			return;
		}
		this.desktopSocket = socket;
		await runDesktopLink(socket, session, () => job === this.desktopJob);
		if (job === this.desktopJob) void this.onDesktopLinkEnded(phone);
	}

	/** Reconnects to a desktop that's still running. One that's over stays over until someone asks again. */
	private async onDesktopLinkEnded(phone: Phone) {
		const job = this.desktopJob;
		await sleep(LINK_SETTLE_MILLIS);
		if (job !== this.desktopJob || this.phone !== phone) return;
		this.update({ desktop: "connecting" });
		try {
			if (!(await phone.desktop.isServerRunning())) {
				if (job === this.desktopJob) this.endDesktopLink("The desktop ended.");
				return;
			}
		} catch (error) {
			console.info("the phone went away while reconnecting", error);
			return;
		}
		await sleep(RECONNECT_MILLIS);
		if (job === this.desktopJob && this.phone === phone) void this.openDesktopLink();
	}

	private endDesktopLink(notice: string) {
		this.desktopJob++;
		this.desktopSocket = null;
		this.session?.detach();
		this.update({ desktop: "ended", notice, desktopStatus: null, desktopStats: null, hasPicture: false });
	}

	// Minori's machines

	/** Asks Minori for its machines, starting it if it isn't running. Only when someone opens the menu. */
	async loadMachines() {
		const phone = this.phone;
		if (!phone) return;
		this.update({ machinesProblem: null });
		try {
			const machines = await listMachines(phone);
			if (this.phone === phone) this.update({ machines });
		} catch (error) {
			if (this.phone === phone) this.update({ machinesProblem: message(error) });
		}
	}

	/** Shows the Pixel's desktop or a machine. The Pixel's desktop keeps running on the phone while it's not shown. */
	chooseSource(source: Source) {
		const current = this.state.source;
		if (JSON.stringify(current) === JSON.stringify(source)) return;
		this.closeMachine();
		if (source.kind === "pixel") {
			this.update({ source, machineView: null, machineMessage: null });
			void this.restartDesktop();
			return;
		}
		if (current.kind === "pixel") {
			// Let go of the Pixel's desktop link, so its video doesn't stream to a hidden canvas.
			this.desktopJob++;
			void this.desktopSocket?.close();
			this.desktopSocket = null;
			this.session?.detach();
			this.update({ desktop: "connecting", hasPicture: false, desktopStats: null });
		}
		this.update({ source, machineView: "starting", machineMessage: null });
	}

	/** The machine's screen hands over its canvas, or its console's element, when it appears. */
	attachMachine(element: HTMLElement) {
		const { source } = this.state;
		const phone = this.phone;
		if (source.kind !== "machine" || !phone) return;
		this.closeMachine();
		const view = new MachineView(phone, source, {
			onState: (machineView, machineMessage) => {
				if (this.machine === view) this.update({ machineView, machineMessage });
			},
		});
		this.machine = view;
		if (source.view === "desktop") void view.showDesktop(element as HTMLCanvasElement);
		else void view.showConsole(element);
	}

	releaseMachine() {
		this.closeMachine();
	}

	/** Opens the machine's desktop or console again, after it ended. */
	retryMachine() {
		this.update({ machineView: "starting", machineMessage: null, machineAttempt: this.state.machineAttempt + 1 });
	}

	private closeMachine() {
		this.machine?.close();
		this.machine = null;
	}

	// Ending

	/** Ends the desktop and the network, and hands USB back so adb and other tools can use the phone again. */
	endSession() {
		const phone = this.phone;
		this.session?.stop();
		const link = this.link;
		this.link = null;
		link?.deactivate();
		this.phone = null;
		this.job++;
		this.desktopJob++;
		this.closeMachine();
		this.update({
			step: "usb",
			phone: null,
			usbDevice: null,
			launchStage: null,
			source: { kind: "pixel" },
			minoriInstalled: false,
			machines: null,
			machineView: null,
			machineMessage: null,
			network: "off",
			desktop: "off",
			desktopStatus: null,
			desktopStats: null,
			hasPicture: false,
			busy: null,
			error: null,
			notice: phone
				? "Session ended. Your phone's back on its own network, and USB debugging is free for other tools."
				: "Your phone wasn't connected, so its desktop ends by itself in two minutes, and its own network comes back within seconds.",
		});
		setTimeout(() => void phone?.close().catch(() => undefined), RELEASE_DELAY_MILLIS);
	}
}

class CancelledError extends Error {
	constructor() {
		super("Cancelled.");
		this.name = "CancelledError";
	}
}
