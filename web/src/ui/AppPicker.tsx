import { useMemo, useState } from "react";
import { airiLink, machineAppLink } from "../asahi/airi";
import type { AppsFrom as AppsFromPlace, AsahiState, Controller } from "../asahi/controller";

/** An app in a list to pick from: an Android app with its icon, or a Linux app from Airi. */
export interface PickableApp {
	key: string;
	name: string;
	/** A second line, such as a Linux app's desktop file. */
	detail?: string;
	/** A `data:` address for its icon, if it has one. */
	icon?: string | null;
}

interface Props {
	apps: PickableApp[];
	selected: string | null;
	onPick: (key: string) => void;
	/** Shown while an icon is on its way, and for apps without one. */
	fallbackIcon: React.ReactNode;
	label: string;
}

/** Long lists get a search field, since a phone can have a hundred apps or more. */
const SEARCH_FROM = 9;

/** A grid of apps with a search field, for picking one to show alone. */
export function AppPicker({ apps, selected, onPick, fallbackIcon, label }: Props) {
	const [query, setQuery] = useState("");
	const shown = useMemo(() => {
		const words = query.trim().toLowerCase();
		if (!words) return apps;
		return apps.filter((app) => `${app.name} ${app.detail ?? ""}`.toLowerCase().includes(words));
	}, [apps, query]);
	return (
		<div className="app-picker">
			{apps.length >= SEARCH_FROM ? (
				<mdui-text-field
					className="app-search"
					variant="outlined"
					placeholder={`Search ${apps.length} apps`}
					aria-label="Search apps"
					value={query}
					clearable
					onInput={(event: React.FormEvent<HTMLElement>) =>
						setQuery((event.target as HTMLInputElement).value)
					}
				>
					<mdui-icon-search slot="icon" />
				</mdui-text-field>
			) : null}
			<fieldset className="app-grid" aria-label={label}>
				{shown.map((app) => (
					<label
						key={app.key}
						className={`app-tile ${app.key === selected ? "app-tile-selected" : ""}`}
						title={app.detail ? `${app.name}\n${app.detail}` : app.name}
					>
						<input
							type="radio"
							name={label}
							className="choice-input"
							checked={app.key === selected}
							onChange={() => onPick(app.key)}
						/>
						{app.icon ? (
							<img className="app-icon" src={app.icon} alt="" width={48} height={48} />
						) : (
							<span className="app-icon app-icon-fallback" aria-hidden="true">
								{fallbackIcon}
							</span>
						)}
						<span className="app-name">{app.name}</span>
						{app.detail ? <span className="app-detail">{app.detail}</span> : null}
					</label>
				))}
				{shown.length === 0 ? <p className="app-none">No app matches "{query.trim()}".</p> : null}
			</fieldset>
		</div>
	);
}

/** The apps from one place, as they're listed: waiting, why there are none, or the picker. Picking one chooses it. */
export function AppsFrom({
	controller,
	state,
	from,
}: {
	controller: Controller;
	state: AsahiState;
	from: AppsFromPlace;
}) {
	const android = from.kind === "android";
	const list = android ? state.androidApps : state.linuxApps;
	const problem = android ? state.androidAppsProblem : state.linuxAppsProblem;
	const status = android
		? "Asking Android for its apps. This takes a few seconds."
		: (state.linuxAppsStatus ?? "Looking for apps.");
	if (!list || list.length === 0) {
		return (
			<div className={`apps-note ${problem ? "apps-note-problem" : ""}`} role="status">
				{problem ? <mdui-icon-error-outline /> : <mdui-circular-progress />}
				<span>{problem ?? status}</span>
				{problem ? (
					<mdui-button variant="text" onClick={() => void controller.openApps(from, true)}>
						Try again
					</mdui-button>
				) : null}
			</div>
		);
	}
	const { source } = state;
	if (android) {
		const apps = state.androidApps ?? [];
		return (
			<AppPicker
				label="Android apps"
				apps={apps.map((app) => ({
					key: app.component,
					name: app.name,
					icon: app.icon,
					// Two apps can share a name, such as Google's Calculator and Airi's GNOME one, so their packages tell them apart.
					detail: apps.some((other) => other !== app && other.name === app.name)
						? app.packageName
						: undefined,
				}))}
				selected={source.kind === "android-app" ? source.component : null}
				fallbackIcon={<mdui-icon-android />}
				onPick={(component) => {
					const app = apps.find((each) => each.component === component);
					if (app) controller.chooseSource({ kind: "android-app", component, name: app.name });
				}}
			/>
		);
	}
	const link = (desktopId: string) =>
		from.kind === "machine" ? machineAppLink(from.vm, desktopId) : airiLink(desktopId);
	const apps = state.linuxApps ?? [];
	return (
		<AppPicker
			label={from.kind === "machine" ? `Apps in ${from.name}` : "Linux apps"}
			apps={apps.map((app) => ({
				key: app.desktopId,
				name: app.name,
				detail: app.desktopId,
				icon: state.linuxAppIcons[app.desktopId],
			}))}
			selected={
				source.kind === "linux-app"
					? (apps.find((app) => link(app.desktopId) === source.app)?.desktopId ?? null)
					: null
			}
			fallbackIcon={<mdui-icon-web-asset />}
			onPick={(desktopId) => {
				const app = apps.find((each) => each.desktopId === desktopId);
				if (app) controller.chooseSource({ kind: "linux-app", app: link(desktopId), name: app.name });
			}}
		/>
	);
}
