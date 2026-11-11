import { type SoundState, sharpSuggestion, toggleFullscreen } from "@wonderhoy-labs/shinonome";
import { formatRate, type LogTotals } from "@wonderhoy-labs/shira";
import { useEffect, useRef, useState } from "react";
import { airiLink, type LinuxApp, machineAppLink } from "../asahi/airi";
import type { AppsFrom, AsahiState, Controller } from "../asahi/controller";
import type { Machine } from "../asahi/minori";
import { type MachineSource, type Source, sourceLabel } from "../asahi/sources";
import { NetworkPanel, useLogSnapshot } from "./NetworkPanel";

interface Props {
	controller: Controller;
	state: AsahiState;
}

function useIsFullscreen(): boolean {
	const [fullscreen, setFullscreen] = useState(false);
	useEffect(() => {
		const onChange = () => setFullscreen(document.fullscreenElement !== null);
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	}, []);
	return fullscreen;
}

/** Whether files are being dragged over the element, which hands any dropped there to onDrop. */
function useFileDrop(
	element: React.RefObject<HTMLElement | null>,
	enabled: boolean,
	onDrop: (files: File[]) => void,
): boolean {
	const [dragging, setDragging] = useState(false);
	const latest = useRef({ enabled, onDrop });
	latest.current = { enabled, onDrop };
	useEffect(() => {
		const target = element.current;
		if (!target) {
			return;
		}
		const listeners = new AbortController();
		const { signal } = listeners;
		target.addEventListener(
			"dragover",
			(event) => {
				if (latest.current.enabled && event.dataTransfer?.types.includes("Files")) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "copy";
					setDragging(true);
				}
			},
			{ signal },
		);
		target.addEventListener(
			"dragleave",
			(event) => {
				if (!target.contains(event.relatedTarget as Node | null)) {
					setDragging(false);
				}
			},
			{ signal },
		);
		target.addEventListener(
			"drop",
			(event) => {
				event.preventDefault();
				setDragging(false);
				latest.current.onDrop(Array.from(event.dataTransfer?.files ?? []));
			},
			{ signal },
		);
		return () => listeners.abort();
	}, [element]);
	return dragging;
}

/** Always dark, because the desktop sits on black and anything bright pulls your eye away from it. */
export function Live({ controller, state }: Props) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const fullscreen = useIsFullscreen();
	// With no desktop there's nothing else to show, so the network fills the screen.
	const noDesktop = state.desktop === "unavailable";
	const [panelOpen, setPanelOpen] = useState(false);
	const snapshot = useLogSnapshot(controller, false);
	const area = useRef<HTMLDivElement>(null);
	const machine = state.source.kind === "machine" ? state.source : null;
	const dragging = useFileDrop(
		area,
		state.desktop === "up" && !machine,
		(files) => void controller.saveToPhone(files),
	);

	useEffect(() => {
		if (canvas.current) controller.attachCanvas(canvas.current);
		return () => controller.releaseCanvas();
	}, [controller]);

	const showPanel = noDesktop || panelOpen;
	return (
		<main className={`live mdui-theme-dark ${noDesktop ? "live-no-desktop" : ""}`}>
			{/* Fullscreen is all desktop. The browser says how to leave, by holding Esc. */}
			{fullscreen ? null : (
				<TopBar
					controller={controller}
					state={state}
					totals={snapshot.totals}
					panelOpen={showPanel}
					onTogglePanel={noDesktop ? undefined : () => setPanelOpen(!panelOpen)}
					canvas={canvas}
				/>
			)}
			<div className="live-body">
				<div className="screen-area" ref={area}>
					{/* Stays on the page while a machine is shown, so the Pixel's desktop picks up where it was. */}
					<canvas
						id="screen"
						ref={canvas}
						width={1920}
						height={1080}
						tabIndex={0}
						aria-label="Phone desktop"
						hidden={machine !== null}
					/>
					{machine ? (
						<MachineScreen
							key={`${machine.vm}-${machine.view}-${state.machineAttempt}`}
							controller={controller}
							state={state}
							source={machine}
						/>
					) : dragging ? (
						<ScreenNote text="Drop to save in your phone's Downloads." icon={<mdui-icon-upload-file />} />
					) : (
						<ScreenMessage controller={controller} state={state} />
					)}
					{machine ? null : <SharpPrompt controller={controller} state={state} />}
				</div>
				{showPanel && !fullscreen ? (
					<NetworkPanel
						controller={controller}
						state={state}
						snapshot={snapshot}
						onClose={noDesktop ? undefined : () => setPanelOpen(false)}
					/>
				) : null}
			</div>
		</main>
	);
}

interface TopBarProps extends Props {
	totals: LogTotals;
	panelOpen: boolean;
	onTogglePanel: (() => void) | undefined;
	canvas: React.RefObject<HTMLCanvasElement | null>;
}

const SOUND_LABELS: Record<SoundState, string> = {
	off: "Sound plays on your phone. Play it here",
	"needs-click": "Click to let this page play your phone's sound",
	starting: "Moving the sound here",
	on: "Sound plays here. Move it back to your phone",
	failed: "Your phone wouldn't share its sound",
};

const SHARP_LABEL_ON =
	"Sharp mode is on: the desktop uses your phone's density, which apps like Discord need. Turn it off for the lowest latency";
const SHARP_LABEL_OFF =
	"Sharp mode: use your phone's density, which apps like Discord need, at a little more latency. Those apps restart when it turns on";

function TopBar({ controller, state, totals, panelOpen, onTogglePanel, canvas }: TopBarProps) {
	const { desktop, desktopStats, sound, sharp } = state;
	return (
		<header className="top-bar">
			<img className="top-bar-logo" src="./logo.webp" alt="" />
			<span className="top-bar-phone">{state.phone ?? state.usbDevice ?? "Your phone"}</span>
			<SourceMenu controller={controller} state={state} />
			{state.appsFrom ? <AppsDialog controller={controller} state={state} from={state.appsFrom} /> : null}
			{state.source.kind === "machine" ? (
				<StatusChip light={machineLight(state)} icon={<mdui-icon-computer />} label={machineLabel(state)} />
			) : (
				<StatusChip
					light={desktopLight(state)}
					icon={<mdui-icon-desktop-windows />}
					label={desktopLabel(state)}
				>
					{desktopStats && desktop === "up" ? (
						<span className="chip-detail">
							{desktopStats.fps} fps ·{" "}
							{desktopStats.latencyMs === null ? "–" : `${desktopStats.latencyMs.toFixed(0)} ms`}
						</span>
					) : null}
				</StatusChip>
			)}
			<StatusChip
				light={networkLight(state)}
				icon={<mdui-icon-public />}
				label={networkLabel(state)}
				onClick={onTogglePanel}
				selected={panelOpen}
			>
				{state.network === "up" ? (
					<span className="chip-detail">
						<mdui-icon-arrow-downward /> {formatRate(totals.downRate)} <mdui-icon-arrow-upward />{" "}
						{formatRate(totals.upRate)}
					</span>
				) : null}
			</StatusChip>
			<span className="top-bar-space" />
			{state.error ? (
				<span className="top-bar-error" role="alert" title={state.error}>
					<mdui-icon-error-outline />
					<span className="ellipsis">{state.error}</span>
					{state.network === "off" && state.phone ? (
						<button
							type="button"
							className="top-bar-error-action"
							onClick={() => void controller.restartNetwork()}
						>
							Turn on
						</button>
					) : null}
					<mdui-button-icon aria-label="Dismiss" title="Dismiss" onClick={() => controller.dismissError()}>
						<mdui-icon-close />
					</mdui-button-icon>
				</span>
			) : null}
			{/* Plain titles, because the bar goes away while the pointer's on these and an mdui tooltip can't cope. */}
			<mdui-button-icon
				title={SOUND_LABELS[sound]}
				aria-label={SOUND_LABELS[sound]}
				disabled={desktop !== "up"}
				onClick={() => controller.toggleSound()}
			>
				{sound === "on" || sound === "starting" ? <mdui-icon-volume-up /> : <mdui-icon-volume-off />}
			</mdui-button-icon>
			<mdui-button-icon
				title={sharp ? SHARP_LABEL_ON : SHARP_LABEL_OFF}
				aria-label={sharp ? SHARP_LABEL_ON : SHARP_LABEL_OFF}
				variant={sharp ? "tonal" : "standard"}
				disabled={desktop !== "up"}
				onClick={() => controller.toggleSharp()}
			>
				<mdui-icon-hd />
			</mdui-button-icon>
			<mdui-button-icon
				title="Fullscreen"
				aria-label="Fullscreen"
				disabled={desktop !== "up"}
				onClick={() => {
					if (canvas.current) void toggleFullscreen(canvas.current);
				}}
			>
				<mdui-icon-fullscreen />
			</mdui-button-icon>
			<mdui-button variant="tonal" className="end-session" onClick={() => controller.endSession()}>
				<mdui-icon-power-settings-new slot="icon" />
				End session
			</mdui-button>
		</header>
	);
}

type Light = "good" | "busy" | "bad" | "off";

function StatusChip({
	light,
	icon,
	label,
	children,
	onClick,
	selected,
}: {
	light: Light;
	icon: React.ReactNode;
	label: string;
	children?: React.ReactNode;
	onClick?: () => void;
	selected?: boolean;
}) {
	const content = (
		<>
			<span className={`light light-${light}`} aria-hidden="true" />
			{icon}
			<span className="chip-label">{label}</span>
			{children}
		</>
	);
	if (!onClick) return <span className="status-chip">{content}</span>;
	return (
		<button
			type="button"
			className={`status-chip status-chip-button ${selected ? "status-chip-selected" : ""}`}
			onClick={onClick}
			aria-pressed={selected}
		>
			{content}
		</button>
	);
}

function SourceIcon({ source }: { source: Source }) {
	switch (source.kind) {
		case "pixel":
			return <mdui-icon-smartphone slot="icon" />;
		case "screen":
			return <mdui-icon-stay-current-portrait slot="icon" />;
		case "app":
			return <mdui-icon-web-asset slot="icon" />;
		case "machine":
			return source.view === "desktop" ? <mdui-icon-computer slot="icon" /> : <mdui-icon-terminal slot="icon" />;
	}
}

/**
 * Picks what the tab shows: the Pixel's desktop or its own screen, one Linux app through Airi, or a Minori machine's
 * desktop or console. Airi's and Minori's entries only show when they're on the phone.
 */
function SourceMenu({ controller, state }: Props) {
	const { source, machines, machinesProblem, minoriInstalled, airiInstalled } = state;
	const pick = (machine: Machine, view: MachineSource["view"]) =>
		controller.chooseSource({ kind: "machine", vm: machine.id, name: machine.name, view });
	let items: React.ReactNode = null;
	if (!minoriInstalled) {
		items = null;
	} else if (machinesProblem) {
		items = <mdui-menu-item disabled>{machinesProblem}</mdui-menu-item>;
	} else if (machines === null) {
		items = <mdui-menu-item disabled>Asking Minori for its machines</mdui-menu-item>;
	} else if (machines.length === 0) {
		items = <mdui-menu-item disabled>No machines in Minori yet</mdui-menu-item>;
	} else {
		items = machines.flatMap((machine) => {
			const note = machine.state === "running" ? "" : " · starts it";
			return [
				// A desktop goes through Minori's guest agent; a console doesn't need it.
				machine.agent ? (
					<mdui-menu-item key={`${machine.id}-desktop`} onClick={() => pick(machine, "desktop")}>
						<mdui-icon-computer slot="icon" />
						{machine.name}: desktop{note}
					</mdui-menu-item>
				) : null,
				<mdui-menu-item key={`${machine.id}-console`} onClick={() => pick(machine, "console")}>
					<mdui-icon-terminal slot="icon" />
					{machine.name}: console{note}
				</mdui-menu-item>,
				// Airi shows a machine's apps once Minori has set Airi up in it.
				machine.airi && airiInstalled ? (
					<mdui-menu-item
						key={`${machine.id}-apps`}
						onClick={() =>
							void controller.openApps({ kind: "machine", vm: machine.id, name: machine.name })
						}
					>
						<mdui-icon-web-asset slot="icon" />
						{machine.name}: one app{note}
					</mdui-menu-item>
				) : null,
			];
		});
	}
	return (
		<mdui-dropdown>
			<mdui-button
				slot="trigger"
				variant="text"
				className="source-button"
				onClick={() => {
					if (minoriInstalled) void controller.loadMachines();
				}}
			>
				<SourceIcon source={source} />
				{sourceLabel(source)}
				<mdui-icon-arrow-drop-down slot="end-icon" />
			</mdui-button>
			<mdui-menu>
				<mdui-menu-item onClick={() => controller.chooseSource({ kind: "pixel" })}>
					<mdui-icon-smartphone slot="icon" />
					Pixel desktop
				</mdui-menu-item>
				<mdui-menu-item onClick={() => controller.chooseSource({ kind: "screen" })}>
					<mdui-icon-stay-current-portrait slot="icon" />
					Pixel screen
				</mdui-menu-item>
				{airiInstalled ? (
					<mdui-menu-item onClick={() => void controller.openApps({ kind: "terminal" })}>
						<mdui-icon-web-asset slot="icon" />
						One Linux app
					</mdui-menu-item>
				) : null}
				{minoriInstalled ? <mdui-divider /> : null}
				{items}
			</mdui-menu>
		</mdui-dropdown>
	);
}

/**
 * Lists Linux apps from Android's terminal or a Minori machine, through Airi. Picking one shows it alone, filling the tab,
 * through Shinonome; Airi opens it, and Minori starts its machine first.
 */
function AppsDialog({ controller, state, from }: Props & { from: AppsFrom }) {
	const dialog = useRef<HTMLElement>(null);
	useEffect(() => {
		// React can't listen for this event by name, because of how it spells custom element events.
		const element = dialog.current;
		const onClosed = () => controller.closeApps();
		element?.addEventListener("closed", onClosed);
		return () => element?.removeEventListener("closed", onClosed);
	}, [controller]);
	const { linuxApps, linuxAppsStatus, linuxAppsProblem } = state;
	const open = (app: LinuxApp) =>
		controller.chooseSource({
			kind: "app",
			app: from.kind === "machine" ? machineAppLink(from.vm, app.desktopId) : airiLink(app.desktopId),
			name: app.name,
		});
	return (
		<mdui-dialog
			ref={dialog as never}
			open
			close-on-esc
			close-on-overlay-click
			headline={from.kind === "machine" ? `Apps in ${from.name}` : "Linux apps"}
			description="Shown alone, filling the tab. Airi opens it on the phone."
		>
			{linuxApps && linuxApps.length > 0 ? (
				<div className="apps-list">
					{linuxApps.map((app) => (
						<button key={app.desktopId} type="button" className="apps-item" onClick={() => open(app)}>
							<span className="apps-name">{app.name}</span>
							<span className="apps-id">{app.desktopId}</span>
						</button>
					))}
				</div>
			) : (
				<p className="apps-note">
					{linuxAppsProblem ?? linuxAppsStatus ?? (linuxApps ? "No apps." : "Looking for apps.")}
				</p>
			)}
			{linuxAppsProblem ? (
				<mdui-button slot="action" variant="text" onClick={() => void controller.openApps(from)}>
					Try again
				</mdui-button>
			) : null}
			<mdui-button slot="action" variant="text" onClick={() => controller.closeApps()}>
				Close
			</mdui-button>
		</mdui-dialog>
	);
}

/** A Minori machine's desktop or console, in place of the Pixel's desktop. */
function MachineScreen({ controller, state, source }: Props & { source: MachineSource }) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const terminal = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = source.view === "desktop" ? canvas.current : terminal.current;
		if (element) controller.attachMachine(element);
		return () => controller.releaseMachine();
	}, [controller, source.view]);
	const { machineView, machineMessage } = state;
	return (
		<>
			{source.view === "desktop" ? (
				<canvas
					id="machine-screen"
					ref={canvas}
					width={1280}
					height={720}
					tabIndex={0}
					aria-label={`${source.name}'s desktop`}
				/>
			) : (
				<div className="machine-console" ref={terminal} />
			)}
			{machineView === "ended" ? (
				<div className="screen-card" role="status">
					{source.view === "desktop" ? <mdui-icon-computer /> : <mdui-icon-terminal />}
					<h2>
						{source.name}'s {source.view} closed
					</h2>
					<p>{machineMessage ?? "It ended."}</p>
					<div className="actions">
						<mdui-button variant="filled" onClick={() => controller.retryMachine()}>
							Open it again
						</mdui-button>
						<mdui-button variant="text" onClick={() => controller.chooseSource({ kind: "pixel" })}>
							Back to the Pixel
						</mdui-button>
					</div>
				</div>
			) : machineView === "starting" || machineView === "connecting" ? (
				<ScreenNote
					text={
						machineMessage ??
						(machineView === "starting" ? `Getting ${source.name} ready.` : `Connecting to ${source.name}.`)
					}
					icon={<mdui-circular-progress />}
				/>
			) : null}
		</>
	);
}

function machineLight({ machineView }: AsahiState): Light {
	if (machineView === "up") return "good";
	if (machineView === "ended") return "bad";
	return "busy";
}

function machineLabel({ source, machineView }: AsahiState): string {
	if (source.kind !== "machine") return "";
	if (machineView === "up") return source.name;
	if (machineView === "ended") return `${source.name} closed`;
	return `${source.name} starting`;
}

function desktopLight({ desktop }: AsahiState): Light {
	if (desktop === "up") return "good";
	if (desktop === "starting" || desktop === "connecting") return "busy";
	if (desktop === "phone-lost" || desktop === "unavailable") return "bad";
	return "off";
}

function desktopLabel({ desktop, source }: AsahiState): string {
	// What Shinonome is showing: the desktop, the phone's screen, or one app.
	const what = source.kind === "screen" ? "Screen" : source.kind === "app" ? "App" : "Desktop";
	switch (desktop) {
		case "up":
			return what;
		case "starting":
		case "connecting":
			return `${what} starting`;
		case "unavailable":
			return source.kind === "pixel" ? "No desktop" : `No ${what.toLowerCase()}`;
		case "phone-lost":
			return `${what} waiting`;
		default:
			return `${what} off`;
	}
}

function networkLight({ network }: AsahiState): Light {
	if (network === "up") return "good";
	if (network === "starting" || network === "connecting" || network === "server-lost") return "busy";
	if (network === "phone-lost") return "bad";
	return "off";
}

function networkLabel({ network, serverLabel }: AsahiState): string {
	switch (network) {
		case "up":
			return serverLabel ?? "Online";
		case "starting":
		case "connecting":
			return "Connecting";
		case "server-lost":
			return "Reconnecting";
		case "phone-lost":
			return "Network waiting";
		default:
			return "Network off";
	}
}

function ScreenMessage({ controller, state }: Props) {
	const { desktop, desktopStatus, hasPicture } = state;
	if (desktop === "phone-lost" || (state.phone === null && state.network === "phone-lost")) {
		return (
			<div className="screen-card" role="alert">
				<mdui-icon-usb />
				<h2>Your phone was disconnected</h2>
				<p>
					{state.phoneKind === "adb-server"
						? "Connect it again from the start."
						: "Plug it back in and this carries on by itself. Your desktop waits for two minutes."}
				</p>
				<div className="actions">
					{state.phoneKind === "usb" ? (
						<mdui-button variant="filled" onClick={() => void controller.connectUsb()}>
							Connect phone
						</mdui-button>
					) : null}
					<mdui-button variant="text" onClick={() => controller.endSession()}>
						Leave
					</mdui-button>
				</div>
			</div>
		);
	}
	if (desktop === "unavailable") {
		return (
			<div className="screen-card" role="status">
				<mdui-icon-desktop-access-disabled />
				<h2>Your phone can't make a desktop</h2>
				<p>{state.desktopProblem}</p>
				<p className="screen-card-note">The network works without it.</p>
				<div className="actions">
					<mdui-button variant="tonal" onClick={() => void controller.restartDesktop()}>
						<mdui-icon-refresh slot="icon" />
						Try again
					</mdui-button>
				</div>
			</div>
		);
	}
	if (desktop === "ended" || desktop === "off") {
		return (
			<div className="screen-card" role="status">
				<mdui-icon-desktop-windows />
				<h2>The desktop ended</h2>
				<p>{state.notice ?? "Start it again whenever you like. Your windows come back where they were."}</p>
				<div className="actions">
					<mdui-button variant="filled" onClick={() => void controller.restartDesktop()}>
						Start the desktop
					</mdui-button>
				</div>
			</div>
		);
	}
	if (desktopStatus && !desktopStatus.usable) {
		return <ScreenNote text="Your phone is locked. Unlock it to carry on." icon={<mdui-icon-lock />} />;
	}
	if (desktop === "starting" || desktop === "connecting") {
		return <ScreenNote text="Connecting to your phone's desktop." icon={<mdui-circular-progress />} />;
	}
	if (desktopStatus && !desktopStatus.desktop) {
		return (
			<ScreenNote
				text="This phone didn't make the display a desktop, so windows may not behave as expected."
				icon={<mdui-icon-error-outline />}
			/>
		);
	}
	if (!hasPicture) {
		return <ScreenNote text="Waiting for the first picture." icon={<mdui-circular-progress />} />;
	}
	if (state.transfer) {
		return (
			<ScreenNote
				text={`Sending ${state.transfer.name} to your phone… ${state.transfer.percent}%`}
				icon={<mdui-circular-progress value={state.transfer.percent / 100} />}
			/>
		);
	}
	if (state.transferNote) {
		return <ScreenNote text={state.transferNote} icon={<mdui-icon-upload-file />} />;
	}
	return null;
}

/** Offers sharp mode when the app in front needs it, at the bottom, out of the app's way. */
function SharpPrompt({ controller, state }: { controller: Controller; state: AsahiState }) {
	const app = state.desktop === "up" ? sharpSuggestion(state.desktopStatus, state.sharp, state.sharpDeclined) : null;
	if (!app) {
		return null;
	}
	return (
		<div className="sharp-prompt" role="alert">
			<mdui-icon-hd />
			<span>
				{app} needs sharp mode to lay out properly. Turning it on restarts {app}, and costs a little latency.
			</span>
			<mdui-button variant="text" onClick={() => controller.declineSharp(app)}>
				Not now
			</mdui-button>
			<mdui-button variant="tonal" onClick={() => controller.setSharp(true)}>
				Turn on
			</mdui-button>
		</div>
	);
}
/** Doesn't take clicks, so the desktop underneath stays usable. */
function ScreenNote({ text, icon }: { text: string; icon: React.ReactNode }) {
	return (
		<div className="screen-note" role="status">
			{icon}
			<span>{text}</span>
		</div>
	);
}
