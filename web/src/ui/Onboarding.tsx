import shiraApkUrl from "@wonderhoy-labs/shira/shira.apk?url";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { adbServerAvailable } from "../adb/dev-server";
import { isUsbAvailable } from "../adb/usb";
import { SHIRA_RELEASES_URL } from "../asahi/constants";
import {
	type AsahiState,
	type Controller,
	capabilities,
	computerRouteAvailable,
	type LaunchStage,
	readyToLaunch,
	SETUP_STEPS,
	type Step,
} from "../asahi/controller";
import {
	availability,
	machineLabel,
	machinesFor,
	SETUP_TITLES,
	type Setup,
	type Source,
	setupOf,
} from "../asahi/sources";
import { AppsFrom } from "./AppPicker";
import { SetupIcon } from "./Icons";

interface Props {
	controller: Controller;
	state: AsahiState;
}

export function Onboarding({ controller, state }: Props) {
	return (
		<main className="onboarding">
			<Hero />
			<section className="setup-card" aria-label="Set up">
				<SetupHeader state={state} />
				<ol className="stepper">
					<StepItem step="usb" state={state} title="Connect your phone" summary={state.usbDevice}>
						<UsbStep controller={controller} />
					</StepItem>
					<StepItem
						step="authorize"
						state={state}
						title="Allow USB debugging"
						summary={state.phone ? "Allowed" : null}
					>
						<AuthorizeStep controller={controller} state={state} />
					</StepItem>
					<StepItem
						step="server"
						state={state}
						title={computerRouteAvailable ? "Choose the network" : "Pick a Wisp server"}
						summary={
							state.serverLabel ? state.serverLabel[0]?.toUpperCase() + state.serverLabel.slice(1) : null
						}
						onChange={() => controller.goBack("server")}
					>
						<ServerStep controller={controller} state={state} />
					</StepItem>
					<StepItem
						step="app"
						state={state}
						title="Install the app"
						summary={state.app?.versionName ? `Shira ${state.app.versionName}` : null}
						onChange={() => controller.goBack("app")}
					>
						<AppStep controller={controller} state={state} />
					</StepItem>
					<StepItem step="launch" state={state} title="Choose and launch" summary={null}>
						<LaunchStep controller={controller} state={state} />
					</StepItem>
				</ol>
				<Banners controller={controller} state={state} />
				<p className="setup-footer">
					<mdui-icon-verified-user />
					<span>
						This page can do anything adb can on the phone you connect, so only use it from an address you
						trust. It runs entirely in your browser.
					</span>
				</p>
			</section>
		</main>
	);
}

function Hero() {
	return (
		<section className="hero">
			<div className="hero-art">
				<img src="./logo.webp" alt="" width={136} height={136} />
			</div>
			<h1>Your whole phone, in a browser tab</h1>
			<p className="hero-lead">
				Asahi lets you use your phone from this tab: Android's desktop or its own screen, any of its apps, and
				the Linux apps and machines it runs. The phone gets online through the same cable, even with Wi-Fi and
				mobile data turned off. There's nothing to install on this computer.
			</p>
			<ul className="features">
				<Feature icon={<mdui-icon-smartphone />} title="Android, your way">
					Android's desktop mode with windows and a taskbar, the phone's own screen, or one app alone, with
					your mouse and keyboard.
				</Feature>
				<Feature icon={<mdui-icon-terminal />} title="Linux too">
					One Linux app from Airi, or a Minori machine's desktop or console, right beside Android.
				</Feature>
				<Feature icon={<mdui-icon-public />} title="Internet over USB">
					{computerRouteAvailable
						? "Your phone's traffic goes down the cable and out through this computer, or a Wisp server you choose."
						: "Your phone's traffic goes down the cable and out through a Wisp server you choose."}
				</Feature>
				<Feature icon={<mdui-icon-usb />} title="Only USB debugging">
					No root, no adb and no drivers. Chrome or Edge on any computer will do.
				</Feature>
			</ul>
		</section>
	);
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
	return (
		<li className="feature">
			<span className="feature-icon">{icon}</span>
			<span>
				<strong>{title}</strong>
				<span className="feature-text">{children}</span>
			</span>
		</li>
	);
}

function SetupHeader({ state }: { state: AsahiState }) {
	const index = SETUP_STEPS.indexOf(state.step);
	return (
		<header className="setup-header">
			<h2>Set up</h2>
			<span className="setup-count">
				Step {index + 1} of {SETUP_STEPS.length}
			</span>
			<mdui-linear-progress value={index} max={SETUP_STEPS.length - 1} />
		</header>
	);
}

interface StepItemProps {
	step: Step;
	state: AsahiState;
	title: string;
	summary: string | null;
	onChange?: () => void;
	children: ReactNode;
}

function StepItem({ step, state, title, summary, onChange, children }: StepItemProps) {
	const current = SETUP_STEPS.indexOf(state.step);
	const index = SETUP_STEPS.indexOf(step);
	const active = index === current;
	const done = index < current;
	const changeable = done && onChange && !state.launchStage;
	return (
		<li
			className={`step ${active ? "step-active" : ""} ${done ? "step-done" : ""}`}
			aria-current={active ? "step" : undefined}
		>
			<div className="step-rail" aria-hidden="true">
				<span className="step-badge">{done ? <mdui-icon-check /> : index + 1}</span>
				<span className="step-line" />
			</div>
			<div className="step-main">
				<div className="step-head">
					<span className="step-title">{title}</span>
					{done && summary ? <span className="step-summary">{summary}</span> : null}
					{changeable ? (
						<mdui-button variant="text" className="step-change" onClick={onChange}>
							Change
						</mdui-button>
					) : null}
				</div>
				{active ? <div className="step-body">{children}</div> : null}
			</div>
		</li>
	);
}

function UsbStep({ controller }: Pick<Props, "controller">) {
	return (
		<>
			<p>
				On your phone, turn on <strong>USB debugging</strong> in Developer options. Then plug it into this
				computer with a cable that carries data, and pick it from the list.
			</p>
			{isUsbAvailable ? (
				<div className="actions">
					<mdui-button variant="filled" onClick={() => void controller.connectUsb()}>
						<mdui-icon-usb slot="icon" />
						Connect phone
					</mdui-button>
				</div>
			) : (
				<div className="callout callout-warning">
					<mdui-icon-error-outline />
					<span>
						This browser can't use USB. Chrome, Edge and other Chromium browsers can, on a computer. Safari
						and Firefox don't have WebUSB.
					</span>
				</div>
			)}
			{adbServerAvailable ? <DevDevices controller={controller} /> : null}
		</>
	);
}

/**
 * Emulators have no USB, so in development, and when installed as an Isolated Web App, the page can also find devices
 * through the adb server.
 */
function DevDevices({ controller }: { controller: Controller }) {
	const [devices, setDevices] = useState<import("../adb/dev-server").DevDevice[]>([]);
	useEffect(() => {
		let stopped = false;
		const load = async () => {
			try {
				const { listDevDevices } = await import("../adb/dev-server");
				const found = await listDevDevices();
				if (!stopped) setDevices(found);
			} catch (error) {
				console.info("no adb server to list devices from", error);
			}
		};
		void load();
		const timer = setInterval(() => void load(), 3000);
		return () => {
			stopped = true;
			clearInterval(timer);
		};
	}, []);
	if (devices.length === 0) return null;
	return (
		<div className="dev-devices">
			<span className="note">
				{import.meta.env.DEV
					? "From the adb server (development only):"
					: "Phones adb on this computer can see:"}
			</span>
			<div className="actions">
				{devices.map((device) => (
					<mdui-button
						key={device.serial}
						variant="tonal"
						onClick={() => void controller.connectThroughAdbServer(device)}
					>
						{device.label}
					</mdui-button>
				))}
			</div>
		</div>
	);
}

function AuthorizeStep({ controller, state }: Props) {
	return (
		<>
			<div className="phone-prompt" aria-hidden="true">
				<span className="phone-prompt-title">Allow USB debugging?</span>
				<span className="phone-prompt-text">The computer's RSA key fingerprint is shown here.</span>
				<span className="phone-prompt-check">
					<mdui-icon-check /> Always allow from this computer
				</span>
				<span className="phone-prompt-actions">
					<span>Cancel</span>
					<span className="phone-prompt-allow">Allow</span>
				</span>
			</div>
			<p>
				Unlock {state.usbDevice ?? "your phone"}. If it asks whether to allow USB debugging, tick{" "}
				<strong>Always allow from this computer</strong> and tap <strong>Allow</strong>. If you've allowed this
				browser before, it carries on by itself.
			</p>
			<Waiting text={state.busy ?? "Waiting for your phone."} />
			<div className="actions">
				<mdui-button variant="text" onClick={() => controller.cancelAuthorize()}>
					Cancel
				</mdui-button>
			</div>
		</>
	);
}

function ServerStep({ controller, state }: Props) {
	if (!computerRouteAvailable) return <WispForm controller={controller} state={state} />;
	return (
		<>
			<p>Your phone's traffic can go out through this computer's own connection, or through a Wisp server.</p>
			<fieldset className="route-options" aria-label="Network">
				<RouteOption
					selected={state.route === "computer"}
					onSelect={() => controller.setRoute("computer")}
					icon={<mdui-icon-computer />}
					title="This computer"
					text="Asahi opens your phone's connections itself, like a tether. No server, and nothing else to run."
				/>
				<RouteOption
					selected={state.route === "wisp"}
					onSelect={() => controller.setRoute("wisp")}
					icon={<mdui-icon-dns />}
					title="A Wisp server"
					text="Your phone's traffic goes out from a server you choose, wherever it is."
				/>
			</fieldset>
			{state.route === "computer" ? (
				<div className="actions">
					<mdui-button variant="filled" onClick={() => controller.chooseComputer()}>
						Continue
					</mdui-button>
				</div>
			) : (
				<WispForm controller={controller} state={state} />
			)}
		</>
	);
}

function RouteOption({
	selected,
	onSelect,
	icon,
	title,
	text,
}: {
	selected: boolean;
	onSelect: () => void;
	icon: ReactNode;
	title: string;
	text: string;
}) {
	return (
		<label className={`route-option${selected ? " route-option-selected" : ""}`}>
			<input type="radio" name="route" className="route-option-input" checked={selected} onChange={onSelect} />
			<span className="route-option-icon">{icon}</span>
			<span className="route-option-text">
				<strong>{title}</strong>
				<span>{text}</span>
			</span>
			{selected ? <mdui-icon-check-circle className="route-option-check" /> : null}
		</label>
	);
}

function WispForm({ controller, state }: Props) {
	const passwordRef = useRef<HTMLInputElement & { value: string }>(null);
	const submit = () => void controller.chooseServer(passwordRef.current?.value ?? "");
	const recent = state.recentServers.filter((url) => url !== state.serverInput);
	return (
		<>
			<p>
				A Wisp server carries your phone's traffic out to the internet. Everything your phone does goes through
				it, so use one you run yourself or trust.
			</p>
			<form
				className="server-form"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<mdui-text-field
					label="Wisp server"
					placeholder="wss://example.com/wisp/"
					value={state.serverInput}
					variant="outlined"
					autocomplete="url"
					onInput={(event: React.FormEvent<HTMLElement>) =>
						controller.setServerInput((event.target as HTMLInputElement).value)
					}
				>
					<mdui-icon-dns slot="icon" />
				</mdui-text-field>
				{recent.length > 0 ? (
					<fieldset className="recent-servers" aria-label="Recent servers">
						{recent.map((url) => (
							<RecentServer
								key={url}
								url={url}
								onPick={() => controller.setServerInput(url)}
								onForget={() => controller.forgetServer(url)}
							/>
						))}
					</fieldset>
				) : null}
				{state.loginNeeded ? (
					<div className="login-fields">
						<mdui-text-field
							label="Username"
							value={state.username}
							variant="outlined"
							autocomplete="username"
							onInput={(event: React.FormEvent<HTMLElement>) =>
								controller.setUsername((event.target as HTMLInputElement).value)
							}
						/>
						<mdui-text-field
							ref={passwordRef as never}
							label="Password"
							type="password"
							toggle-password
							variant="outlined"
							autocomplete="current-password"
						/>
					</div>
				) : null}
				<div className="actions">
					<mdui-button
						variant="filled"
						type="submit"
						loading={state.checkingServer}
						disabled={state.checkingServer}
					>
						Continue
					</mdui-button>
					{state.loginNeeded ? null : (
						<mdui-button variant="text" onClick={() => controller.showLogin()}>
							<mdui-icon-vpn-key slot="icon" />
							Add a login
						</mdui-button>
					)}
				</div>
			</form>
		</>
	);
}

function RecentServer({ url, onPick, onForget }: { url: string; onPick: () => void; onForget: () => void }) {
	const chip = useRef<HTMLElement>(null);
	useEffect(() => {
		// React can't listen for this event by name, because of how it spells custom element events.
		const element = chip.current;
		element?.addEventListener("delete", onForget);
		return () => element?.removeEventListener("delete", onForget);
	}, [onForget]);
	return (
		<mdui-chip ref={chip as never} variant="input" deletable onClick={onPick}>
			<mdui-icon-history slot="icon" />
			{url.replace(/^wss?:\/\//, "")}
		</mdui-chip>
	);
}

function AppStep({ controller, state }: Props) {
	const { app } = state;
	const outdated = app?.installed && !state.appCurrent;
	const verb = outdated ? "Update" : "Install";
	if (state.installing) {
		return (
			<>
				<p>
					{state.installProgress < 1
						? `Sending Shira ${__SHIRA_VERSION__} to your phone.`
						: "Your phone is installing it."}
				</p>
				<mdui-linear-progress value={state.installProgress < 1 ? state.installProgress : undefined} max={1} />
			</>
		);
	}
	if (state.installManually) {
		return (
			<>
				<p>
					Install the APK on your phone however you like. This page notices by itself when it's there, or you
					can check again whenever you're ready.
				</p>
				<div className="actions">
					<mdui-button variant="tonal" href={shiraApkUrl} download={`shira-v${__SHIRA_VERSION__}.apk`}>
						<mdui-icon-download slot="icon" />
						Download APK
					</mdui-button>
					<mdui-button variant="text" href={SHIRA_RELEASES_URL} target="_blank" rel="noreferrer">
						All releases
					</mdui-button>
					<mdui-button variant="text" onClick={() => controller.cancelManualInstall()}>
						Back
					</mdui-button>
				</div>
				<Waiting text="Waiting for the app to appear on your phone." />
			</>
		);
	}
	return (
		<>
			<p>
				Asahi's app is Shira, which gives your phone its connection. The desktop needs nothing installed. This
				page only installs Shira if you ask.
			</p>
			<AppStatus state={state} />
			<div className="actions">
				{state.appCurrent ? (
					<mdui-button variant="filled" onClick={() => controller.confirmApp()}>
						Continue
					</mdui-button>
				) : state.offerUninstall ? (
					<mdui-button variant="filled" onClick={() => void controller.uninstallAndInstall()}>
						Remove and reinstall
					</mdui-button>
				) : (
					<>
						<mdui-button variant="filled" onClick={() => void controller.installApp()}>
							<mdui-icon-install-mobile slot="icon" />
							{verb} it for me
						</mdui-button>
						<mdui-button variant="outlined" onClick={() => void controller.installManually()}>
							I'll {verb.toLowerCase()} it myself
						</mdui-button>
					</>
				)}
				<mdui-button variant="text" loading={state.checkingApp} onClick={() => void controller.checkApp()}>
					<mdui-icon-refresh slot="icon" />
					Check again
				</mdui-button>
			</div>
		</>
	);
}

function AppStatus({ state }: { state: AsahiState }) {
	const { app } = state;
	if (!app) return null;
	if (state.appCurrent) {
		return (
			<div className="callout callout-good">
				<mdui-icon-check-circle />
				<span>
					<strong>Shira {app.versionName}</strong> is installed on your phone.
				</span>
			</div>
		);
	}
	if (app.installed) {
		return (
			<div className="callout">
				<mdui-icon-info />
				<span>
					Your phone has Shira {app.versionName}, and this page needs {__SHIRA_VERSION__} or newer.
				</span>
			</div>
		);
	}
	return (
		<div className="callout">
			<mdui-icon-info />
			<span>Shira isn't on your phone yet.</span>
		</div>
	);
}

/** What each kind of thing to show is, in a line, for the cards that pick one. */
const SETUP_TEXT: Record<Setup, string> = {
	"android-desktop": "Android's desktop mode, with windows and a taskbar.",
	"android-screen": "Your phone's own screen, mirrored, with your mouse and keyboard.",
	"android-app": "One of your phone's apps on its own, filling the tab.",
	"linux-app": "One Linux app on its own, from Airi or a Minori machine.",
	"linux-desktop": "A Minori machine's whole desktop.",
	"linux-console": "A Minori machine's text console.",
};

const SETUP_GROUPS: { title: string; setups: Setup[] }[] = [
	{ title: "Android", setups: ["android-desktop", "android-screen", "android-app"] },
	{ title: "Linux", setups: ["linux-app", "linux-desktop", "linux-console"] },
];

/** What starting the picked thing does, as the second line of the launch list. */
function showItem(source: Source): { title: string; text: string } {
	const screenOff =
		"Your phone's screen turns off while you use it from here. It stays unlocked underneath until you end the session.";
	switch (source.kind) {
		case "desktop":
			return { title: "Start the desktop", text: screenOff };
		case "screen":
			return { title: "Mirror the screen", text: "Your phone's screen stays on and shows the same as this tab." };
		case "android-app":
			return { title: `Open ${source.name}`, text: `On a display of its own. ${screenOff}` };
		case "linux-app":
			return { title: `Open ${source.name}`, text: `Airi opens it on a display of its own. ${screenOff}` };
		case "machine":
			return {
				title: `Open ${source.name}'s ${source.view}`,
				text: "Minori starts the machine first if it isn't running, which can take a minute.",
			};
	}
}

function LaunchStep({ controller, state }: Props) {
	const running = state.launchStage !== null;
	const ready = readyToLaunch(state);
	const show = showItem(state.source);
	const items: { stage: LaunchStage; icon: ReactNode; title: string; text: string }[] = [
		{
			stage: "network",
			icon: <mdui-icon-public />,
			title: "Turn on the network",
			text: `Gives Asahi Android's VPN permission through USB debugging, the same as tapping OK on the phone, and connects it to ${state.serverLabel ?? "your server"}.`,
		},
		{ stage: "desktop", icon: <SetupIcon setup={setupOf(state.source)} />, ...show },
	];
	const stageIndex = items.findIndex((item) => item.stage === state.launchStage);
	return (
		<>
			{state.serverMessage ? <p className="motd">{state.serverMessage}</p> : null}
			<SourceChooser controller={controller} state={state} disabled={running} />
			{ready ? (
				<ul className="launch-list">
					{items.map((item, index) => {
						const status = !running
							? "todo"
							: index < stageIndex
								? "done"
								: index === stageIndex
									? "doing"
									: "todo";
						return (
							<li key={item.stage} className={`launch-item launch-item-${status}`}>
								<span className="launch-icon">
									{status === "done" ? (
										<mdui-icon-check />
									) : status === "doing" ? (
										<mdui-circular-progress />
									) : (
										item.icon
									)}
								</span>
								<span>
									<strong>{item.title}</strong>
									<span className="launch-text">{item.text}</span>
								</span>
							</li>
						);
					})}
				</ul>
			) : null}
			{running && state.busy ? <Waiting text={state.busy} /> : null}
			<div className="actions">
				{running ? (
					<mdui-button variant="text" onClick={() => controller.cancelLaunch()}>
						Cancel
					</mdui-button>
				) : (
					<>
						<mdui-button
							variant="filled"
							className="launch-button"
							disabled={!ready}
							onClick={() => void controller.launch()}
						>
							<mdui-icon-rocket-launch slot="icon" />
							Launch
						</mdui-button>
						{ready ? null : <span className="note">{notReadyNote(state)}</span>}
					</>
				)}
			</div>
		</>
	);
}

function notReadyNote(state: AsahiState): string {
	const check = availability(state.setup, capabilities(state));
	if (!check.ok) return check.checking ? check.reason : "Pick something this phone can show.";
	switch (state.setup) {
		case "android-app":
		case "linux-app":
			return "Pick an app to show.";
		default:
			return "Pick a machine.";
	}
}

/**
 * The six kinds of thing the tab can show, as cards, with whatever has to be picked for the chosen one underneath.
 * Ones this phone can't do say why. The last choice comes back next time.
 */
function SourceChooser({ controller, state, disabled }: Props & { disabled: boolean }) {
	const phone = capabilities(state);
	return (
		<section className="chooser" aria-labelledby="chooser-title">
			<h3 id="chooser-title" className="chooser-title">
				What do you want to see?
			</h3>
			{SETUP_GROUPS.map((group) => (
				<fieldset key={group.title} className="choice-group" disabled={disabled}>
					<legend className="choice-legend">{group.title}</legend>
					<div className="choice-grid">
						{group.setups.map((setup) => {
							const check = availability(setup, phone);
							const selected = state.setup === setup;
							return (
								<label
									key={setup}
									className={`choice ${selected ? "choice-selected" : ""} ${check.ok ? "" : "choice-unavailable"}`}
								>
									<input
										type="radio"
										name="setup"
										className="choice-input"
										checked={selected}
										disabled={!check.ok}
										onChange={() => controller.pickSetup(setup)}
									/>
									<span className="choice-icon">
										<SetupIcon setup={setup} />
									</span>
									<span className="choice-title">{SETUP_TITLES[setup]}</span>
									<span className="choice-text" title={check.ok ? undefined : check.reason}>
										{check.ok ? (
											SETUP_TEXT[setup]
										) : (
											<>
												{check.checking ? (
													<mdui-circular-progress className="choice-spinner" />
												) : null}
												{check.reason}
											</>
										)}
									</span>
									{selected ? <mdui-icon-check-circle className="choice-check" /> : null}
								</label>
							);
						})}
					</div>
					{group.title === "Linux" && state.minoriInstalled && state.machinesProblem ? (
						<mdui-button
							variant="text"
							className="choice-retry"
							onClick={() => void controller.loadMachines()}
						>
							<mdui-icon-refresh slot="icon" />
							Ask Minori again
						</mdui-button>
					) : null}
				</fieldset>
			))}
			{availability(state.setup, phone).ok ? (
				<SetupDetail controller={controller} state={state} setup={state.setup} />
			) : null}
		</section>
	);
}

/** What has to be picked for a kind of thing: an app, where a Linux app comes from, or a machine. */
function SetupDetail({ controller, state, setup }: Props & { setup: Setup }) {
	const { source } = state;
	if (setup === "android-app") {
		return (
			<div className="choice-detail">
				<PickedNote source={source} setup={setup} />
				<AppsFrom controller={controller} state={state} from={{ kind: "android" }} />
			</div>
		);
	}
	if (setup === "linux-app") {
		const from = state.appsFrom?.kind === "terminal" || state.appsFrom?.kind === "machine" ? state.appsFrom : null;
		const machines = (state.machines ?? []).filter((machine) => machine.airi);
		return (
			<div className="choice-detail">
				{machines.length > 0 ? (
					<div className="place-chips" role="radiogroup" aria-label="Where the app runs">
						<mdui-chip
							variant="filter"
							selected={from?.kind === "terminal"}
							onClick={() => void controller.openApps({ kind: "terminal" })}
						>
							Android's terminal
						</mdui-chip>
						{machines.map((machine) => (
							<mdui-chip
								key={machine.id}
								variant="filter"
								selected={from?.kind === "machine" && from.vm === machine.id}
								onClick={() =>
									void controller.openApps({ kind: "machine", vm: machine.id, name: machine.name })
								}
							>
								{machineLabel(machine)}
								{machine.state === "running" ? "" : " (starts it)"}
							</mdui-chip>
						))}
					</div>
				) : null}
				<PickedNote source={source} setup={setup} />
				{from ? <AppsFrom controller={controller} state={state} from={from} /> : null}
			</div>
		);
	}
	if (setup === "linux-desktop" || setup === "linux-console") {
		const machines = machinesFor(setup, state.machines ?? []);
		const view = setup === "linux-desktop" ? "desktop" : "console";
		return (
			<div className="choice-detail">
				<div className="place-chips" role="radiogroup" aria-label="Machine">
					{machines.map((machine) => (
						<mdui-chip
							key={machine.id}
							variant="filter"
							selected={source.kind === "machine" && source.vm === machine.id}
							onClick={() =>
								controller.chooseSource({ kind: "machine", vm: machine.id, name: machine.name, view })
							}
						>
							<mdui-icon-computer slot="icon" />
							{machineLabel(machine)}
							{machine.state === "running" ? "" : " · starts it"}
						</mdui-chip>
					))}
				</div>
			</div>
		);
	}
	return null;
}

/** The app that's picked, which may be from last time and not in the list being shown. */
function PickedNote({ source, setup }: { source: Source; setup: Setup }) {
	if (setupOf(source) !== setup || (source.kind !== "android-app" && source.kind !== "linux-app")) return null;
	return (
		<p className="picked-note">
			<mdui-icon-check-circle />
			<span>
				<strong>{source.name}</strong> is picked.
			</span>
		</p>
	);
}

function Banners({ controller, state }: Props) {
	return (
		<>
			{state.notice ? (
				<div className="banner banner-notice" role="status">
					<mdui-icon-check-circle />
					<span>{state.notice}</span>
					<mdui-button-icon onClick={() => controller.dismissNotice()} aria-label="Dismiss">
						<mdui-icon-close />
					</mdui-button-icon>
				</div>
			) : null}
			{state.error ? (
				<div className="banner banner-error" role="alert">
					<mdui-icon-error-outline />
					<span>{state.error}</span>
					<mdui-button-icon onClick={() => controller.dismissError()} aria-label="Dismiss">
						<mdui-icon-close />
					</mdui-button-icon>
				</div>
			) : null}
		</>
	);
}

export function Waiting({ text }: { text: string }) {
	return (
		<div className="waiting" role="status">
			<mdui-circular-progress />
			<span>{text}</span>
		</div>
	);
}
