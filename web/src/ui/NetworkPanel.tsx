import { useVirtualizer } from "@tanstack/react-virtual";
import {
	describeClose,
	describeQueryType,
	formatBytes,
	formatDuration,
	formatRate,
	formatTime,
	type LogRow,
	type LogTotals,
	type RowKind,
} from "@wonderhoy-labs/shira";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AsahiState, Controller } from "../asahi/controller";

const REFRESH_MILLIS = 250;
const ROW_HEIGHT = 60;

type StateFilter = "all" | "active" | "failed";
type KindFilter = "all" | RowKind;

export interface LogSnapshot {
	rows: LogRow[];
	totals: LogTotals;
	now: number;
	redraw: () => void;
}

/** Follows the log a few times a second, whatever's happening underneath. */
export function useLogSnapshot(controller: Controller, paused: boolean): LogSnapshot {
	const { log } = controller;
	const [rows, setRows] = useState<LogRow[]>([]);
	const [totals, setTotals] = useState<LogTotals>(() => log.totals(Date.now()));
	const [now, setNow] = useState(() => Date.now());
	const seen = useRef(-1);

	useEffect(() => {
		const refresh = () => {
			const time = Date.now();
			setNow(time);
			setTotals(log.totals(time));
			if (paused || seen.current === log.version) return;
			seen.current = log.version;
			// A new array, because React won't redraw for rows that only changed inside.
			setRows(log.rows.map((row) => ({ ...row })).reverse());
		};
		refresh();
		const timer = setInterval(refresh, REFRESH_MILLIS);
		return () => clearInterval(timer);
	}, [log, paused]);

	return { rows, totals, now, redraw: () => (seen.current = -1) };
}

interface Props {
	controller: Controller;
	state: AsahiState;
	snapshot: LogSnapshot;
	onClose: (() => void) | undefined;
}

/** The phone's network: how it's doing, and every connection it makes. */
export function NetworkPanel({ controller, state, snapshot, onClose }: Props) {
	const [search, setSearch] = useState("");
	const [stateFilter, setStateFilter] = useState<StateFilter>("all");
	const [kindFilter, setKindFilter] = useState<KindFilter>("all");
	const [selected, setSelected] = useState<number | null>(null);
	const { rows, totals, now, redraw } = snapshot;

	const visible = useMemo(() => {
		const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
		return rows.filter((row) => {
			if (stateFilter === "active" && row.state !== "open") return false;
			if (stateFilter === "failed" && row.state !== "failed") return false;
			if (kindFilter !== "all" && row.kind !== kindFilter) return false;
			if (words.length === 0) return true;
			const text = `${row.name} ${row.host}:${row.port} ${controller.log.appName(row)} ${row.kind}`.toLowerCase();
			return words.every((word) => text.includes(word));
		});
	}, [rows, search, stateFilter, kindFilter, controller.log]);

	const selectedRow = selected === null ? null : (rows.find((row) => row.id === selected) ?? null);

	return (
		<aside className="network-panel" aria-label="Network">
			<header className="panel-header">
				<h2>Network</h2>
				<span className="panel-header-space" />
				<mdui-button-icon
					title="Save the log as JSON"
					aria-label="Save the log as JSON"
					onClick={() => saveLog(controller)}
				>
					<mdui-icon-download />
				</mdui-button-icon>
				<mdui-button-icon
					title="Clear the log"
					aria-label="Clear the log"
					onClick={() => {
						controller.log.clear();
						redraw();
					}}
				>
					<mdui-icon-delete-outline />
				</mdui-button-icon>
				{onClose ? (
					<mdui-button-icon title="Close" aria-label="Close" onClick={onClose}>
						<mdui-icon-close />
					</mdui-button-icon>
				) : null}
			</header>
			<NetworkCard controller={controller} state={state} totals={totals} />
			<div className="panel-filters">
				<mdui-text-field
					className="search"
					variant="outlined"
					placeholder="Search by name, address, app or port"
					value={search}
					clearable
					onInput={(event: React.FormEvent<HTMLElement>) =>
						setSearch((event.target as HTMLInputElement).value)
					}
				>
					<mdui-icon-search slot="icon" />
				</mdui-text-field>
				<fieldset className="filter-group" aria-label="Filter">
					<FilterChip
						label="All"
						selected={stateFilter === "all" && kindFilter === "all"}
						onClick={() => {
							setStateFilter("all");
							setKindFilter("all");
						}}
					/>
					<FilterChip
						label="Active"
						selected={stateFilter === "active"}
						onClick={() => setStateFilter(stateFilter === "active" ? "all" : "active")}
					/>
					<FilterChip
						label="Failed"
						selected={stateFilter === "failed"}
						onClick={() => setStateFilter(stateFilter === "failed" ? "all" : "failed")}
					/>
					<FilterChip
						label="DNS"
						selected={kindFilter === "dns"}
						onClick={() => setKindFilter(kindFilter === "dns" ? "all" : "dns")}
					/>
					<FilterChip
						label="UDP"
						selected={kindFilter === "udp"}
						onClick={() => setKindFilter(kindFilter === "udp" ? "all" : "udp")}
					/>
				</fieldset>
			</div>
			<LogList
				rows={visible}
				now={now}
				controller={controller}
				isEmpty={rows.length === 0}
				onSelect={setSelected}
			/>
			{selectedRow ? (
				<RowDetails row={selectedRow} now={now} controller={controller} onClose={() => setSelected(null)} />
			) : null}
		</aside>
	);
}

function FilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
	return (
		<mdui-chip variant="filter" selected={selected} onClick={onClick}>
			{label}
		</mdui-chip>
	);
}

function NetworkCard({ controller, state, totals }: { controller: Controller; state: AsahiState; totals: LogTotals }) {
	const { network } = state;
	return (
		<section className={`network-card network-card-${network}`}>
			<div className="network-card-line">
				<span
					className={`light light-${network === "up" ? "good" : network === "off" ? "off" : network === "phone-lost" ? "bad" : "busy"}`}
				/>
				<strong>{describeNetwork(state)}</strong>
			</div>
			<div className="network-card-detail">
				<mdui-icon-dns /> {state.serverLabel}
				{state.wispVersion ? ` · Wisp v${state.wispVersion}` : ""}
				{state.udp ? " · UDP" : " · no UDP"}
			</div>
			<div className="network-stats">
				<Stat
					icon={<mdui-icon-arrow-downward />}
					label="Down"
					value={formatRate(totals.downRate)}
					detail={formatBytes(totals.down)}
				/>
				<Stat
					icon={<mdui-icon-arrow-upward />}
					label="Up"
					value={formatRate(totals.upRate)}
					detail={formatBytes(totals.up)}
				/>
				<Stat
					icon={<mdui-icon-lan />}
					label="Open"
					value={String(totals.active)}
					detail={`${totals.total} in all, ${totals.failed} failed`}
				/>
			</div>
			{network === "off" ? (
				<div className="network-card-action">
					<span>Your phone's on its own network again.</span>
					<mdui-button variant="filled" onClick={() => void controller.restartNetwork()}>
						Turn it back on
					</mdui-button>
				</div>
			) : network === "server-lost" ? (
				<p className="network-card-note">
					Lost {state.serverLabel}. Your phone's own network is back until this reconnects.
				</p>
			) : network === "up" ? (
				<p className="network-card-note">
					Keep this tab open. Your phone goes back to its own network when you close it.
				</p>
			) : null}
		</section>
	);
}

function describeNetwork({ network, serverLabel }: AsahiState): string {
	switch (network) {
		case "up":
			return `Online through ${serverLabel ?? "your server"}`;
		case "server-lost":
			return "Reconnecting to the server";
		case "phone-lost":
			return "Phone disconnected";
		case "starting":
		case "connecting":
			return "Connecting";
		default:
			return "Off";
	}
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
	return (
		<div className="stat">
			<span className="stat-label">
				{icon} {label}
			</span>
			<span className="stat-value">{value}</span>
			<span className="stat-detail">{detail}</span>
		</div>
	);
}

interface ListProps {
	rows: LogRow[];
	now: number;
	controller: Controller;
	isEmpty: boolean;
	onSelect: (id: number) => void;
}

function LogList({ rows, now, controller, isEmpty, onSelect }: ListProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const virtual = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scroller.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 12,
	});
	return (
		<section className="log" aria-label="Connections">
			<div className="log-body" ref={scroller}>
				{rows.length === 0 ? (
					<div className="log-empty">
						<mdui-icon-lan />
						<p>
							{isEmpty
								? "Nothing yet. Open an app on your phone, and its connections appear here."
								: "Nothing matches that."}
						</p>
					</div>
				) : (
					<div style={{ height: virtual.getTotalSize(), position: "relative" }}>
						{virtual.getVirtualItems().map((item) => {
							const row = rows[item.index];
							if (!row) return null;
							return (
								<button
									type="button"
									key={row.id}
									className={`log-entry log-entry-${row.state}`}
									style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
									onClick={() => onSelect(row.id)}
								>
									<span className="log-line">
										<span className={`kind kind-${row.kind}`}>{row.kind.toUpperCase()}</span>
										<span className="ellipsis log-destination" title={destinationTitle(row)}>
											{destination(row)}
										</span>
										<span className="mono muted log-time">{formatTime(row.openedAt)}</span>
									</span>
									<span className="log-line log-line-detail">
										<span className={`status-pip status-pip-${row.state}`} />
										<span className="ellipsis">
											{row.kind === "dns" ? "Resolver" : controller.log.appName(row)} ·{" "}
											{statusText(row)}
										</span>
										<span className="mono log-bytes">
											↑{formatBytes(row.up)} ↓{formatBytes(row.down)}
											{row.state === "open"
												? ""
												: ` · ${formatDuration((row.closedAt ?? now) - row.openedAt)}`}
										</span>
									</span>
								</button>
							);
						})}
					</div>
				)}
			</div>
		</section>
	);
}

function destination(row: LogRow) {
	if (row.kind === "dns") {
		return (
			<>
				{row.name || "Unknown name"} <span className="muted">{describeQueryType(row.queryType)}</span>
			</>
		);
	}
	return (
		<>
			{row.name || row.host}
			<span className="muted">:{row.port}</span>
		</>
	);
}

function destinationTitle(row: LogRow): string {
	return row.name ? `${row.name} (${row.host}:${row.port})` : `${row.host}:${row.port}`;
}

function statusText(row: LogRow): string {
	if (row.state === "open") return "Open";
	return describeClose(row.closeReason);
}

function RowDetails({
	row,
	now,
	controller,
	onClose,
}: {
	row: LogRow;
	now: number;
	controller: Controller;
	onClose: () => void;
}) {
	const dialog = useRef<HTMLElement>(null);
	useEffect(() => {
		// React can't listen for this event by name, because of how it spells custom element events.
		const element = dialog.current;
		element?.addEventListener("closed", onClose);
		return () => element?.removeEventListener("closed", onClose);
	}, [onClose]);
	return (
		<mdui-dialog ref={dialog as never} open close-on-esc close-on-overlay-click headline={row.name || row.host}>
			<dl className="details">
				<dt>App</dt>
				<dd>{row.kind === "dns" ? "The phone's resolver" : controller.log.appName(row)}</dd>
				{row.uid >= 0 ? (
					<>
						<dt>Android user ID</dt>
						<dd>{row.uid}</dd>
					</>
				) : null}
				<dt>Type</dt>
				<dd>
					{row.kind === "dns" ? `DNS ${describeQueryType(row.queryType)} lookup` : row.kind.toUpperCase()}
				</dd>
				<dt>Address</dt>
				<dd className="mono">
					{row.host}:{row.port}
				</dd>
				<dt>Status</dt>
				<dd>{statusText(row)}</dd>
				<dt>Opened</dt>
				<dd className="mono">{formatTime(row.openedAt)}</dd>
				<dt>Open for</dt>
				<dd>{formatDuration((row.closedAt ?? now) - row.openedAt)}</dd>
				<dt>Uploaded</dt>
				<dd>{formatBytes(row.up)}</dd>
				<dt>Downloaded</dt>
				<dd>{formatBytes(row.down)}</dd>
				<dt>Wisp stream</dt>
				<dd className="mono">{row.stream}</dd>
			</dl>
			<mdui-button slot="action" variant="text" onClick={onClose}>
				Close
			</mdui-button>
		</mdui-dialog>
	);
}

function saveLog(controller: Controller) {
	const url = URL.createObjectURL(new Blob([controller.log.toJson()], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = `asahi-log-${new Date().toISOString().replaceAll(":", "-")}.json`;
	link.click();
	URL.revokeObjectURL(url);
}
