import type { Adb, AdbSocket } from '@yume-chan/adb';
import { PackageManager } from '@yume-chan/android-bin';
import {
  ACTIVATE_SCREEN,
  DESKTOP_PROTOCOL,
  DESKTOP_SOCKET,
  NETWORK_SOCKET,
  PACKAGE,
  SCRIPT_PATH,
  SERVER_DIR,
  SERVICE,
} from '../asahi/constants';

export type PhoneKind = 'usb' | 'adb-server';

const CHUNK_BYTES = 256 * 1024;

export interface AppInfo {
  installed: boolean;
  versionName: string | null;
  versionCode: number | null;
}

export function parseAppInfo(dumpsysOutput: string): AppInfo {
  const code = /versionCode=(\d+)/.exec(dumpsysOutput)?.[1];
  const name = /versionName=(\S+)/.exec(dumpsysOutput)?.[1];
  return {
    installed: code !== undefined,
    versionName: name ?? null,
    versionCode: code === undefined ? null : Number(code),
  };
}

/** Android's own explanation, or the command's output if it doesn't have one. */
export function installFailureReason(output: string): string {
  return /\[?(INSTALL_[A-Z_]+)[\]:]?/.exec(output)?.[1] ?? (output.trim() || "Android didn't say why.");
}

/** Whether a desktop server's log says it's up, holds its socket, and speaks this page's protocol. */
export function isServerReady(log: string): boolean {
  const lines = log.split('\n').map((line) => line.trim());
  return lines.includes(`protocol: ${DESKTOP_PROTOCOL}`) && lines.includes('listening');
}

/** The reason a server gave for not starting, if it gave one. */
export function serverIncompatibility(log: string): string | null {
  return /^incompatible: (.*)$/m.exec(log)?.[1]?.trim() ?? null;
}

function streamOf(bytes: Uint8Array, onSent?: (fraction: number) => void): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.subarray(sent, sent + CHUNK_BYTES);
      sent += chunk.length;
      onSent?.(sent / bytes.length);
      controller.enqueue(chunk);
    },
  });
}

/** A phone reached through adb, and everything Asahi does with it. */
export class Phone {
  constructor(
    readonly adb: Adb,
    readonly name: string,
    readonly kind: PhoneKind,
  ) {}

  get disconnected(): Promise<unknown> {
    return this.adb.disconnected;
  }

  /** As an array, because a string would be split up and lose its quotes on the way to the phone's shell. */
  readonly shell = (command: string): Promise<string> => this.adb.subprocess.noneProtocol.spawnWaitText([command]);

  async appInfo(): Promise<AppInfo> {
    return parseAppInfo(await this.shell(`dumpsys package ${PACKAGE} | grep -E 'versionCode=|versionName=' | head -2`));
  }

  /**
   * Hands an APK to Android's installer. Throws with Android's reason if it refuses.
   *
   * This pushes a temporary file instead of streaming straight into the installer. With streaming, closing
   * the input also closes the socket that the installer's answer comes back on, so success looks like failure.
   */
  async install(apk: Uint8Array, onProgress: (fraction: number) => void): Promise<void> {
    try {
      await new PackageManager(this.adb).pushAndInstallStream(streamOf(apk, onProgress) as never);
    } catch (error) {
      throw new InstallError(installFailureReason(error instanceof Error ? error.message : String(error)));
    }
  }

  async uninstall(): Promise<void> {
    await this.shell(`pm uninstall ${PACKAGE}`);
  }

  // The network

  /**
   * Turns on the VPN without asking anything on the phone.
   *
   * adb is allowed to give an app the same approval the phone's own VPN dialog would, and to give it the
   * notification permission that shows it's running. The screen that opens then starts the service.
   */
  async activateNetwork(): Promise<void> {
    await this.shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS 2>/dev/null`);
    await this.shell(`appops set ${PACKAGE} ACTIVATE_VPN allow`);
    const output = await this.shell(`am start -n ${ACTIVATE_SCREEN}`);
    if (/^Error/m.test(output)) throw new Error(output.trim());
  }

  /** True once the app's own service is running, which is what makes the socket's name safely its own. */
  async isNetworkServiceRunning(): Promise<boolean> {
    const output = await this.shell(`dumpsys activity services ${SERVICE}`);
    return output.includes('ServiceRecord');
  }

  openNetworkSocket(): Promise<AdbSocket> {
    return this.adb.createSocket(NETWORK_SOCKET);
  }

  /** Which package each app ID belongs to, for the log. */
  async packagesByUid(): Promise<Map<number, string>> {
    const output = await this.shell('pm list packages -U');
    const packages = new Map<number, string>();
    for (const match of output.matchAll(/^package:(\S+) uid:(\d+)/gm)) {
      const [, name, uid] = match;
      if (name && uid) packages.set(Number(uid), name);
    }
    return packages;
  }

  // The desktop

  /**
   * By reading a running server's log, rather than just trying the socket, because any app on the phone
   * could be listening on that name. The server only logs this once it holds the name itself.
   */
  async isDesktopRunning(): Promise<boolean> {
    return isServerReady(await this.shell(`pidof asahi-server >/dev/null && cat ${SERVER_DIR}/server.log`));
  }

  /**
   * Starts the desktop server from the installed app, with the start script this page carries, and returns
   * what it logged. It runs as the shell user, which is what's allowed to make a display Android treats
   * as a monitor.
   */
  async startDesktop(script: string, args: string[] = []): Promise<string> {
    await this.shell(`umask 077; mkdir -p ${SERVER_DIR}; chmod 700 ${SERVER_DIR}`);
    const sync = await this.adb.sync();
    try {
      await sync.write({ filename: SCRIPT_PATH, file: streamOf(new TextEncoder().encode(script)) as never });
    } finally {
      await sync.dispose();
    }
    // Afterwards, because adb can leave a pushed file open to everyone whatever mode it's asked for.
    const extra = args.map((arg) => `'${arg.replaceAll("'", '')}'`).join(' ');
    return this.shell(`chmod 600 ${SCRIPT_PATH}; sh ${SCRIPT_PATH} ${extra}`);
  }

  openDesktopSocket(): Promise<AdbSocket> {
    return this.adb.createSocket(DESKTOP_SOCKET);
  }

  async close(): Promise<void> {
    await this.adb.close();
  }
}

export class InstallError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InstallError';
  }

  /** A copy that's signed with another key, or that's newer, has to be removed first. */
  get needsUninstall(): boolean {
    return this.reason.includes('UPDATE_INCOMPATIBLE') || this.reason.includes('VERSION_DOWNGRADE');
  }
}
