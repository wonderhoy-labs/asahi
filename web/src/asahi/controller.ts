import type { AdbSocket } from '@yume-chan/adb';
import type { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';
import startScript from '../../../android/app/src/main/assets/start.sh?raw';
import { InstallError, serverIncompatibility, type AppInfo, type Phone, type PhoneKind } from '../adb/phone';
import { authorizeUsb, claimUsb, knownPhone, pickPhone, UsbBusyError, type UsbConnection } from '../adb/usb';
import { exposeDebugApi } from '../desktop/debug';
import { DesktopSession, type SessionStats } from '../desktop/desktop-session';
import { frameMessage, FrameReader } from '../desktop/frames';
import type { DesktopStatus } from '../desktop/protocol';
import { CLOSE_NETWORK_ERROR, LinkStatus, MetaKind, StreamType } from '../link/frames';
import { ProtocolMismatchError, Relay, type RelayEvents } from '../link/relay';
import { LogStore } from '../log/store';
import { connectWisp, normalizeServerUrl, WispError, type WispConnection, type WispCredentials } from '../wisp/connection';
import { APK_PATH } from './constants';

/** The onboarding, in order, and then the session itself. */
export type Step = 'usb' | 'authorize' | 'server' | 'app' | 'launch' | 'live';
export const SETUP_STEPS: Step[] = ['usb', 'authorize', 'server', 'app', 'launch'];

export type NetworkState = 'off' | 'starting' | 'connecting' | 'up' | 'server-lost' | 'phone-lost';
export type DesktopState = 'off' | 'starting' | 'connecting' | 'up' | 'unavailable' | 'ended' | 'phone-lost';
export type LaunchStage = 'network' | 'desktop';

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
  /** True if the app's version is what this site carries, or newer. */
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

  /** What to tell the person to do while something's happening. */
  busy: string | null;
  error: string | null;
  notice: string | null;
}

const STORED_SERVER = 'asahi.server';
const STORED_SERVERS = 'asahi.servers';
const STORED_USERNAME = 'asahi.username';
/** Development only: extra options for the desktop server, such as --screen-on. */
const STORED_DEV_DESKTOP_ARGS = 'asahi.dev.desktop-args';
const MAX_RECENT_SERVERS = 4;

const POLL_MILLIS = 1_000;
const FIRST_RETRY_MILLIS = 1_000;
const MAX_RETRY_MILLIS = 15_000;
const SLOW_ACTIVATE_MILLIS = 10_000;
const PACKAGE_REFRESH_MILLIS = 10_000;
const RECONNECT_MILLIS = 1_000;
// Unplugging ends a link too, and that's handled when adb notices, a moment later.
const LINK_SETTLE_MILLIS = 300;
// Long enough for the last messages to reach the phone before USB closes.
const RELEASE_DELAY_MILLIS = 500;
// How long a phone takes to reset its USB after a browser holding it goes away without saying so.
const USB_RESET_MILLIS = 1_500;

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
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
    const list = JSON.parse(stored(STORED_SERVERS) || '[]') as unknown;
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_SERVERS) : [];
  } catch {
    return [];
  }
}

function defaultServer(): string {
  if (import.meta.env.DEV) {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
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

/** Everything the page does, step by step. The screens only show this and call its methods. */
export class Controller {
  readonly log = new LogStore();

  private state: AsahiState = {
    step: 'usb',
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
    network: 'off',
    appVersion: null,
    udp: false,
    wispVersion: null,
    desktop: 'off',
    desktopProblem: null,
    desktopStatus: null,
    desktopStats: null,
    hasPicture: false,
    busy: null,
    error: null,
    notice: null,
  };

  private readonly listeners = new Set<() => void>();
  private phone: Phone | null = null;
  /** The device being authorized, so that waiting for the phone's OK can be called off. */
  private pendingDevice: AdbDaemonWebUsbDevice | null = null;
  private usingUsb = false;
  private apk: Uint8Array<ArrayBuffer> | null = null;
  /** Bumped to cancel whatever setup job is going on. Each one checks it's still current. */
  private job = 0;

  // The network
  private relay: Relay | null = null;
  private wisp: WispConnection | null = null;
  private serverUrl: string | null = null;
  private credentials: WispCredentials | null = null;
  private networkJob = 0;
  private lastPackageRefresh = 0;
  private statusWaiter: ((up: { ok: true } | { ok: false; message: string }) => void) | null = null;
  /** Why the app said it was closing the socket, as opposed to the socket just going away. */
  private goodbye: 'off' | 'replaced' | null = null;

  // The desktop
  private session: DesktopSession | null = null;
  private desktopSocket: AdbSocket | null = null;
  private desktopJob = 0;
  private desktopOpening: Promise<void> = Promise.resolve();

  constructor() {
    navigator.usb?.addEventListener('connect', () => void this.onUsbPlugged());
    // The phone's told by its sockets closing, if this gets to run. If it doesn't, the pings stop.
    window.addEventListener('pagehide', () => void this.phone?.close().catch(() => undefined));
    exposeDebugApi(() => this.session, import.meta.env.DEV ? (command) => this.requirePhone().shell(command) : undefined);
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
    if (!this.phone) throw new Error('The phone was disconnected.');
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
      if (this.state.step === 'authorize') this.update({ step: 'usb', usbDevice: null });
      this.update({ busy: null, error: `Couldn't reach your phone: ${message(error)}` });
    }
  }

  /** Tries once more if USB failed, because a phone resets it just after a browser crashes or is closed. */
  private async attachUsb(device: AdbDaemonWebUsbDevice) {
    try {
      await this.attachDevice(device);
    } catch (error) {
      if (error instanceof UsbBusyError || error instanceof CancelledError) throw error;
      console.info('retrying after a USB failure', error);
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
    const resuming = this.state.step === 'live';
    if (!resuming) this.update({ step: 'authorize', usbDevice: device.name || 'Your phone' });
    this.update({ busy: resuming ? 'Reconnecting to your phone.' : null });
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
    this.update({ step: 'usb', usbDevice: null, busy: null });
  }

  /** Development only: uses a phone or emulator through the adb server, which has already let us in. */
  async connectThroughAdbServer(device: import('../adb/dev-server').DevDevice) {
    if (!import.meta.env.DEV) return;
    this.update({ error: null, notice: null });
    try {
      const { openDevPhone } = await import('../adb/dev-server');
      this.usingUsb = false;
      this.update({ usbDevice: device.label });
      await this.attach(await openDevPhone(device));
    } catch (error) {
      this.update({ busy: null, error: `Couldn't reach that device: ${message(error)}` });
    }
  }

  private async onUsbPlugged() {
    // Only to carry on after a replug. The first connection is always someone's click.
    if (!this.usingUsb || this.phone || this.state.step !== 'live') return;
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
    void this.refreshPackages(true);
    try {
      await this.refreshApp();
    } catch (error) {
      this.phone = null;
      void phone.close().catch(() => undefined);
      throw error;
    }
    if (this.state.step === 'live') {
      await this.resume(phone);
      return;
    }
    this.update({ step: 'server' });
  }

  /** Picks the session back up after the cable comes out and goes back in. */
  private async resume(phone: Phone) {
    if (this.state.network === 'phone-lost' && this.state.appCurrent) void this.runNetwork(true).catch(() => undefined);
    if (this.state.desktop === 'phone-lost') {
      if (await phone.isDesktopRunning()) {
        this.update({ desktop: 'connecting' });
        void this.openDesktopLink();
      } else {
        this.update({ desktop: 'ended', notice: 'The desktop ended while your phone was unplugged.' });
      }
    }
  }

  private onPhoneLost(phone: Phone) {
    if (this.phone !== phone) return;
    this.phone = null;
    this.job++;
    this.statusWaiter?.({ ok: false, message: 'The phone was disconnected.' });
    this.statusWaiter = null;
    if (this.state.step === 'live') {
      this.networkJob++;
      this.desktopJob++;
      this.stopRelay();
      this.desktopSocket = null;
      this.session?.detach();
      const desktopWasOn = ['up', 'connecting', 'starting'].includes(this.state.desktop);
      this.update({
        phone: null,
        busy: null,
        network: this.state.network === 'off' ? 'off' : 'phone-lost',
        desktop: desktopWasOn ? 'phone-lost' : this.state.desktop,
      });
      return;
    }
    this.networkJob++;
    this.stopRelay();
    this.update({
      step: 'usb',
      phone: null,
      usbDevice: null,
      installing: false,
      installManually: false,
      launchStage: null,
      network: 'off',
      desktop: 'off',
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
    if ('problem' in normalized) {
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
      const recentServers = [normalized.url, ...this.state.recentServers.filter((url) => url !== normalized.url)].slice(
        0,
        MAX_RECENT_SERVERS,
      );
      store(STORED_SERVERS, JSON.stringify(recentServers));
      this.update({ checkingServer: false, serverLabel: new URL(normalized.url).host, recentServers, step: 'app' });
    } catch (error) {
      const needsLogin = error instanceof WispError && (error.failure === 'credentials-needed' || error.failure === 'credentials-wrong');
      this.update({ checkingServer: false, loginNeeded: this.state.loginNeeded || needsLogin, error: message(error) });
    }
  }

  forgetServer(url: string) {
    const recentServers = this.state.recentServers.filter((item) => item !== url);
    store(STORED_SERVERS, JSON.stringify(recentServers));
    this.update({ recentServers });
  }

  /** Goes back to an earlier step that's already done, to change it. */
  goBack(step: 'server' | 'app') {
    if (this.state.step === 'live' || this.state.launchStage) return;
    const order = SETUP_STEPS.indexOf(step);
    if (order >= SETUP_STEPS.indexOf(this.state.step)) return;
    this.job++;
    this.update({ step, error: null, installManually: false });
  }

  // Step 4: the app. Nothing's installed unless someone asks.

  private appIsCurrent(app: AppInfo) {
    return app.installed && (app.versionCode ?? 0) >= __ASAHI_VERSION_CODE__;
  }

  private async refreshApp(): Promise<AppInfo> {
    const app = await this.requirePhone().appInfo();
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

  private async fetchApk(): Promise<Uint8Array<ArrayBuffer>> {
    if (!this.apk) {
      const response = await fetch(APK_PATH);
      if (!response.ok) throw new Error(`This site is missing ${APK_PATH}.`);
      this.apk = new Uint8Array(await response.arrayBuffer());
    }
    return this.apk;
  }

  async installApp() {
    this.job++;
    this.update({ installing: true, installProgress: 0, installManually: false, offerUninstall: false, error: null, notice: null });
    try {
      await this.requirePhone().install(await this.fetchApk(), (installProgress) => this.update({ installProgress }));
      await this.refreshApp();
      this.update({ installing: false });
    } catch (error) {
      const uninstall = error instanceof InstallError && error.needsUninstall;
      this.update({
        installing: false,
        offerUninstall: uninstall,
        error: uninstall
          ? "The copy of Asahi on your phone was signed with a different key, or is newer, so Android won't replace it. Remove it to carry on."
          : `Couldn't install the app: ${message(error)}`,
      });
    }
  }

  async uninstallAndInstall() {
    try {
      await this.requirePhone().uninstall();
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
    this.update({ step: 'launch', error: null, notice: null });
  }

  // Step 5: launch

  /** Turns on the network, starts the desktop, and goes to it. */
  async launch() {
    const job = ++this.job;
    this.update({ launchStage: 'network', error: null, notice: null, busy: null });
    try {
      await this.runNetwork(true);
      if (job !== this.job) return;
      this.update({ launchStage: 'desktop', busy: null });
      await this.prepareDesktop();
      if (job !== this.job) return;
      this.update({ launchStage: null, busy: null, step: 'live' });
    } catch (error) {
      if (job !== this.job) return;
      this.networkJob++;
      this.stopRelay();
      if (error instanceof ProtocolMismatchError) {
        this.update({
          launchStage: null,
          network: 'off',
          busy: null,
          step: 'app',
          appCurrent: false,
          error: `${error.message} Install the version from this site.`,
        });
        return;
      }
      this.update({ launchStage: null, network: 'off', busy: null, error: message(error) });
    }
  }

  cancelLaunch() {
    this.job++;
    this.networkJob++;
    this.statusWaiter?.({ ok: false, message: 'Cancelled.' });
    this.statusWaiter = null;
    this.stopRelay();
    this.update({ launchStage: null, network: 'off', busy: null });
  }

  // The network

  /**
   * Gets from here to connected, and resolves the first time the VPN's up. It carries on in the background
   * after that, through a lost server. [startApp] is false when going back to an app that's already running,
   * because anything else would turn Asahi back on after someone turned it off.
   */
  private runNetwork(startApp: boolean): Promise<void> {
    const job = ++this.networkJob;
    const isCurrent = () => this.networkJob === job;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const up = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      void (async () => {
        try {
          const phone = this.requirePhone();
          this.update({ network: 'starting' });
          this.goodbye = null;
          if (startApp) await phone.activateNetwork();
          const relay = await this.waitForApp(phone, isCurrent);
          if (!relay || !isCurrent()) return;
          await this.keepConnected(relay, isCurrent, up);
        } catch (error) {
          if (!isCurrent()) return;
          this.stopRelay();
          if (settled) {
            this.update({ network: 'off', error: `The network stopped: ${message(error)}` });
          } else {
            settled = true;
            reject(error);
          }
        }
      })();
    });
  }

  /**
   * Waits for the app's service, and connects to its socket.
   *
   * Any app on the phone could listen on the socket's name, so this waits until Asahi's own service is
   * running first. The service stops if it can't get the name, so once it's running the name is its own.
   */
  private async waitForApp(phone: Phone, isCurrent: () => boolean): Promise<Relay | null> {
    const started = Date.now();
    while (isCurrent()) {
      if (Date.now() - started > SLOW_ACTIVATE_MILLIS) {
        this.update({ busy: "Unlock your phone. If it's asking about a VPN connection, tap OK." });
      }
      if (await phone.isNetworkServiceRunning()) {
        try {
          const socket = await phone.openNetworkSocket();
          const relay = new Relay(socket, this.relayEvents());
          this.relay = relay;
          const hello = await relay.greet();
          this.update({ appVersion: hello.appVersion, busy: null });
          return relay;
        } catch (error) {
          this.stopRelay();
          if (error instanceof ProtocolMismatchError) throw error;
          // The service is still setting up its socket.
        }
      }
      await sleep(POLL_MILLIS);
    }
    return null;
  }

  /** Stays connected to the Wisp server until the phone goes or the page says stop. */
  private async keepConnected(relay: Relay, isCurrent: () => boolean, onUp: () => void) {
    const url = this.serverUrl;
    if (!url) throw new Error('Choose a Wisp server first.');
    let delay = FIRST_RETRY_MILLIS;
    let everUp = false;

    while (isCurrent() && this.relay === relay) {
      this.update({ network: everUp ? 'server-lost' : 'connecting' });
      let wisp: WispConnection;
      try {
        wisp = await connectWisp(url, this.credentials, relay.downloadGate);
      } catch (error) {
        const refused = error instanceof WispError && error.failure !== 'unreachable';
        // A login problem won't fix itself, and a server that never worked probably has the wrong address.
        if (refused || !everUp) throw error;
        await sleep(delay);
        delay = Math.min(delay * 2, MAX_RETRY_MILLIS);
        continue;
      }
      if (!isCurrent() || this.relay !== relay) {
        wisp.close();
        return;
      }
      this.wisp = wisp;
      const lost = new Promise<void>((resolve) => {
        wisp.onclose = () => resolve();
        wisp.onerror = () => resolve();
      });
      this.update({ udp: wisp.udp_enabled, wispVersion: wisp.wisp_version, serverMessage: wisp.server_motd ?? null });

      const status = new Promise<{ ok: true } | { ok: false; message: string }>((resolve) => {
        this.statusWaiter = resolve;
      });
      relay.attach(wisp, new URL(url).host);
      const result = await status;
      if (!result.ok) {
        wisp.onclose = () => undefined;
        wisp.close();
        throw new Error(result.message);
      }
      everUp = true;
      delay = FIRST_RETRY_MILLIS;
      this.update({ network: 'up', busy: null });
      onUp();

      await lost;
      if (!isCurrent() || this.relay !== relay) return;
      this.wisp = null;
      this.log.closeAll(CLOSE_NETWORK_ERROR, Date.now());
      relay.detach();
      this.update({ network: 'server-lost' });
      await sleep(delay);
    }
  }

  private relayEvents(): RelayEvents {
    return {
      onStreamOpen: (stream, request) => {
        const kind = request.streamType === StreamType.UDP ? 'udp' : 'tcp';
        this.log.open(stream, kind, request.host, request.port, Date.now());
      },
      onStreamMeta: (stream, meta) => {
        this.log.describe(stream, meta.kind === MetaKind.DNS ? 'dns' : null, meta.uid, meta.name, meta.queryType);
        if (meta.uid >= 0 && !this.log.packages.has(meta.uid)) void this.refreshPackages(false);
      },
      onStreamData: (stream, up, down) => this.log.addBytes(stream, up, down),
      onStreamClose: (stream, reason) => this.log.close(stream, reason, Date.now()),
      onStatus: (code, statusMessage) => {
        if (code === LinkStatus.UP) {
          this.statusWaiter?.({ ok: true });
          this.statusWaiter = null;
        } else if (code === LinkStatus.FAILED) {
          this.statusWaiter?.({ ok: false, message: `Android wouldn't start the VPN. ${statusMessage}`.trim() });
          this.statusWaiter = null;
        } else if (code === LinkStatus.OFF) {
          this.goodbye = 'off';
        } else if (code === LinkStatus.REPLACED) {
          this.goodbye = 'replaced';
        }
      },
      onEnded: () => this.onRelayEnded(),
    };
  }

  private onRelayEnded() {
    // Only the relay that's in use matters. One that was let go on purpose has already been cleared.
    if (!this.relay) return;
    this.relay = null;
    this.closeWisp();
    this.log.closeAll(CLOSE_NETWORK_ERROR, Date.now());
    // Unplugging ends this too, and that's handled when adb notices, a moment later.
    if (!this.phone || this.state.network === 'starting') return;
    const standDown = (reason: string) => {
      this.networkJob++;
      this.statusWaiter?.({ ok: false, message: reason });
      this.statusWaiter = null;
      this.update({ network: 'off', error: reason });
    };
    if (this.goodbye === 'off') {
      standDown("Asahi's network stopped on your phone.");
      return;
    }
    if (this.goodbye === 'replaced') {
      standDown("Another page took over your phone's network.");
      return;
    }
    void this.phone.isNetworkServiceRunning().then(
      (running) => {
        if (!this.phone) return;
        // It dropped this connection for being silent, say, so connect again.
        if (running) void this.runNetwork(false).catch((error: unknown) => standDown(message(error)));
        else standDown("Asahi's network stopped on your phone.");
      },
      () => undefined,
    );
  }

  /** Turns the network back on from the session, after it was turned off or failed. */
  async restartNetwork() {
    this.update({ error: null });
    try {
      await this.runNetwork(true);
    } catch (error) {
      this.stopRelay();
      this.update({ network: 'off', busy: null, error: message(error) });
    }
  }

  /** Lets go of the relay without counting it as the app going away. */
  private stopRelay() {
    const relay = this.relay;
    this.relay = null;
    relay?.close();
    this.closeWisp();
    this.log.closeAll(CLOSE_NETWORK_ERROR, Date.now());
  }

  private closeWisp() {
    const wisp = this.wisp;
    this.wisp = null;
    if (!wisp) return;
    wisp.onclose = () => undefined;
    wisp.onerror = () => undefined;
    wisp.close();
  }

  private async refreshPackages(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastPackageRefresh < PACKAGE_REFRESH_MILLIS) return;
    this.lastPackageRefresh = now;
    try {
      const packages = await this.phone?.packagesByUid();
      if (packages) this.log.packages = packages;
    } catch (error) {
      console.warn("couldn't list the phone's packages", error);
    }
  }

  // The desktop

  /** Starts the server, or finds the one that's already running. A phone that can't do it just says why. */
  private async prepareDesktop() {
    this.update({ desktop: 'starting', desktopProblem: null, desktopStatus: null, hasPicture: false });
    try {
      const phone = this.requirePhone();
      if (await phone.isDesktopRunning()) {
        this.update({ desktop: 'connecting' });
        return;
      }
      const output = await phone.startDesktop(startScript, devDesktopArgs());
      const problem = serverIncompatibility(output);
      if (problem) {
        this.update({ desktop: 'unavailable', desktopProblem: problem });
        return;
      }
      if (!(await phone.isDesktopRunning())) {
        throw new Error(`The desktop didn't start. The phone said:\n\n${output.trim().slice(-600)}`);
      }
      this.update({ desktop: 'connecting' });
    } catch (error) {
      this.update({ desktop: 'unavailable', desktopProblem: message(error) });
    }
  }

  /** Starts the desktop again from the session, after it ended or failed. */
  async restartDesktop() {
    this.update({ error: null, notice: null });
    await this.prepareDesktop();
    if (this.state.desktop === 'connecting') void this.openDesktopLink();
  }

  /** The desktop's screen hands over its canvas when it appears. */
  useCanvas(canvas: HTMLCanvasElement) {
    this.session?.dispose();
    this.session = new DesktopSession(canvas, {
      onStatus: (desktopStatus) => this.update({ desktopStatus }),
      onStats: (desktopStats) => this.update({ desktopStats }),
      onFirstFrame: () => this.update({ hasPicture: true }),
      onAuthenticated: () => this.update({ desktop: 'up' }),
      onReplaced: () => this.endDesktopLink('Another window took over the desktop. Start it here to take it back.'),
    });
    if (this.state.desktop === 'connecting') void this.openDesktopLink();
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
    this.update({ desktop: 'connecting' });
    // One at a time. The server hands the desktop to whichever connection arrives last, so a stale one
    // that's still on its way could otherwise take it from this one.
    const previous = this.desktopOpening;
    let opened: () => void = () => undefined;
    this.desktopOpening = new Promise<void>((resolve) => (opened = resolve));
    let socket: AdbSocket;
    try {
      await previous;
      if (job !== this.desktopJob) return;
      socket = await phone.openDesktopSocket();
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
    const writer = socket.writable.getWriter();
    // A lost link shows up on the reading side, which reconnects.
    session.attach((data) => void writer.write(frameMessage(data)).catch(() => undefined));

    const frames = new FrameReader();
    const reader = socket.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        frames.push(value, (data) => {
          if (job === this.desktopJob) session.receive(data);
        });
      }
    } catch (error) {
      console.info('the link to the desktop ended', error);
    }
    if (job === this.desktopJob) {
      session.detach();
      void this.onDesktopLinkEnded(phone);
    }
  }

  /** Reconnects to a desktop that's still running. One that's over stays over until someone asks again. */
  private async onDesktopLinkEnded(phone: Phone) {
    const job = this.desktopJob;
    await sleep(LINK_SETTLE_MILLIS);
    if (job !== this.desktopJob || this.phone !== phone) return;
    this.update({ desktop: 'connecting' });
    try {
      if (!(await phone.isDesktopRunning())) {
        if (job === this.desktopJob) this.endDesktopLink('The desktop ended.');
        return;
      }
    } catch (error) {
      console.info('the phone went away while reconnecting', error);
      return;
    }
    await sleep(RECONNECT_MILLIS);
    if (job === this.desktopJob && this.phone === phone) void this.openDesktopLink();
  }

  private endDesktopLink(notice: string) {
    this.desktopJob++;
    this.desktopSocket = null;
    this.session?.detach();
    this.update({ desktop: 'ended', notice, desktopStatus: null, desktopStats: null, hasPicture: false });
  }

  // Ending

  /** Ends the desktop and the network, and hands USB back so adb and other tools can use the phone again. */
  endSession() {
    const phone = this.phone;
    this.session?.stop();
    const relay = this.relay;
    this.relay = null;
    relay?.deactivate();
    this.closeWisp();
    this.log.closeAll(CLOSE_NETWORK_ERROR, Date.now());
    this.phone = null;
    this.job++;
    this.networkJob++;
    this.desktopJob++;
    this.statusWaiter = null;
    this.update({
      step: 'usb',
      phone: null,
      usbDevice: null,
      launchStage: null,
      network: 'off',
      desktop: 'off',
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
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}
