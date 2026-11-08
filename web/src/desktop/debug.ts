import type { DesktopSession } from './desktop-session';

interface DebugApi {
  isConnected(): boolean;
  getStatus(): DesktopSession['currentStatus'];
  measureClicks: DesktopSession['measureClicks'];
  measureDrag: DesktopSession['measureDrag'];
  shell?: (command: string) => Promise<string>;
}

declare global {
  interface Window {
    asahi?: DebugApi;
  }
}

/** For checking the desktop from the browser's console. A session can come and go underneath it. */
export function exposeDebugApi(getSession: () => DesktopSession | null, shell?: (command: string) => Promise<string>) {
  const session = () => {
    const current = getSession();
    if (!current) {
      throw new Error('No session is running.');
    }
    return current;
  };
  window.asahi = {
    isConnected: () => getSession()?.isConnected ?? false,
    getStatus: () => getSession()?.currentStatus ?? null,
    measureClicks: (options) => session().measureClicks(options),
    measureDrag: (options) => session().measureDrag(options),
    ...(shell ? { shell } : {}),
  };
}
