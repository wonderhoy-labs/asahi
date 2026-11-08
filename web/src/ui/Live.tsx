import { useEffect, useRef, useState } from 'react';
import type { AsahiState, Controller } from '../asahi/controller';
import { toggleFullscreen } from '../desktop/desktop-session';
import { formatRate } from '../log/format';
import type { LogTotals } from '../log/store';
import { NetworkPanel, useLogSnapshot } from './NetworkPanel';

interface Props {
  controller: Controller;
  state: AsahiState;
}

function useIsFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  return fullscreen;
}

/** Always dark, because the desktop sits on black and anything bright pulls your eye away from it. */
export function Live({ controller, state }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fullscreen = useIsFullscreen();
  // With no desktop there's nothing else to show, so the network fills the screen.
  const noDesktop = state.desktop === 'unavailable';
  const [panelOpen, setPanelOpen] = useState(false);
  const snapshot = useLogSnapshot(controller, false);

  useEffect(() => {
    if (canvas.current) controller.useCanvas(canvas.current);
    return () => controller.releaseCanvas();
  }, [controller]);

  const showPanel = noDesktop || panelOpen;
  return (
    <main className={`live mdui-theme-dark ${noDesktop ? 'live-no-desktop' : ''}`}>
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
        <div className="screen-area">
          <canvas id="screen" ref={canvas} width={1920} height={1080} tabIndex={0} aria-label="Phone desktop" />
          <ScreenMessage controller={controller} state={state} />
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

function TopBar({ controller, state, totals, panelOpen, onTogglePanel, canvas }: TopBarProps) {
  const { desktop, desktopStats } = state;
  return (
    <header className="top-bar">
      <img className="top-bar-logo" src="./logo.webp" alt="" />
      <span className="top-bar-phone">{state.phone ?? state.usbDevice ?? 'Your phone'}</span>
      <StatusChip light={desktopLight(state)} icon={<mdui-icon-desktop-windows />} label={desktopLabel(state)}>
        {desktopStats && desktop === 'up' ? (
          <span className="chip-detail" aria-label="Desktop stats">
            {desktopStats.fps} fps · {desktopStats.latencyMs === null ? '–' : `${desktopStats.latencyMs.toFixed(0)} ms`}
          </span>
        ) : null}
      </StatusChip>
      <StatusChip
        light={networkLight(state)}
        icon={<mdui-icon-public />}
        label={networkLabel(state)}
        onClick={onTogglePanel}
        selected={panelOpen}
      >
        {state.network === 'up' ? (
          <span className="chip-detail" aria-label="Network rates">
            <mdui-icon-arrow-downward /> {formatRate(totals.downRate)} <mdui-icon-arrow-upward /> {formatRate(totals.upRate)}
          </span>
        ) : null}
      </StatusChip>
      <span className="top-bar-space" />
      {state.error ? (
        <span className="top-bar-error" role="alert" title={state.error}>
          <mdui-icon-error-outline />
          <span className="ellipsis">{state.error}</span>
          {state.network === 'off' && state.phone ? (
            <button type="button" className="top-bar-error-action" onClick={() => void controller.restartNetwork()}>
              Turn on
            </button>
          ) : null}
          <mdui-button-icon aria-label="Dismiss" title="Dismiss" onClick={() => controller.dismissError()}>
            <mdui-icon-close />
          </mdui-button-icon>
        </span>
      ) : null}
      {/* A plain title, because the bar goes away while the pointer's on this and an mdui tooltip can't cope. */}
      <mdui-button-icon
        title="Fullscreen"
        aria-label="Fullscreen"
        disabled={desktop !== 'up'}
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

type Light = 'good' | 'busy' | 'bad' | 'off';

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
    <button type="button" className={`status-chip status-chip-button ${selected ? 'status-chip-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      {content}
    </button>
  );
}

function desktopLight({ desktop }: AsahiState): Light {
  if (desktop === 'up') return 'good';
  if (desktop === 'starting' || desktop === 'connecting') return 'busy';
  if (desktop === 'phone-lost' || desktop === 'unavailable') return 'bad';
  return 'off';
}

function desktopLabel({ desktop }: AsahiState): string {
  switch (desktop) {
    case 'up':
      return 'Desktop';
    case 'starting':
    case 'connecting':
      return 'Desktop starting';
    case 'unavailable':
      return 'No desktop';
    case 'phone-lost':
      return 'Desktop waiting';
    default:
      return 'Desktop off';
  }
}

function networkLight({ network }: AsahiState): Light {
  if (network === 'up') return 'good';
  if (network === 'starting' || network === 'connecting' || network === 'server-lost') return 'busy';
  if (network === 'phone-lost') return 'bad';
  return 'off';
}

function networkLabel({ network, serverLabel }: AsahiState): string {
  switch (network) {
    case 'up':
      return serverLabel ?? 'Online';
    case 'starting':
    case 'connecting':
      return 'Connecting';
    case 'server-lost':
      return 'Reconnecting';
    case 'phone-lost':
      return 'Network waiting';
    default:
      return 'Network off';
  }
}

function ScreenMessage({ controller, state }: Props) {
  const { desktop, desktopStatus, hasPicture } = state;
  if (desktop === 'phone-lost' || (state.phone === null && state.network === 'phone-lost')) {
    return (
      <div className="screen-card" role="alert">
        <mdui-icon-usb />
        <h2>Your phone was disconnected</h2>
        <p>
          {state.phoneKind === 'adb-server'
            ? 'Connect it again from the start.'
            : 'Plug it back in and this carries on by itself. Your desktop waits for two minutes.'}
        </p>
        <div className="actions">
          {state.phoneKind === 'usb' ? (
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
  if (desktop === 'unavailable') {
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
  if (desktop === 'ended' || desktop === 'off') {
    return (
      <div className="screen-card" role="status">
        <mdui-icon-desktop-windows />
        <h2>The desktop ended</h2>
        <p>{state.notice ?? 'Start it again whenever you like. Your windows come back where they were.'}</p>
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
  if (desktop === 'starting' || desktop === 'connecting') {
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
  return null;
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
