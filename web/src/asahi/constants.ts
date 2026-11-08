export const PACKAGE = 'com.wonderhoylabs.asahi';
export const SERVICE = `${PACKAGE}/.vpn.AsahiVpnService`;
export const SCREEN = `${PACKAGE}/.ui.MainActivity`;
/** Starts the VPN when opened. Only adb is allowed to open it. */
export const ACTIVATE_SCREEN = `${PACKAGE}/.Activate`;
/** Where the app's VPN service listens for the network link. */
export const NETWORK_SOCKET = 'localabstract:asahi';
/** Where the desktop server listens. It runs as the shell user, started through adb. */
export const DESKTOP_SOCKET = 'localabstract:asahi-desktop';
export const SERVER_DIR = '/data/local/tmp/asahi';
export const SCRIPT_PATH = `${SERVER_DIR}/start.sh`;
/** Must match PROTOCOL in Server.java. A server with another number gets replaced by the one here. */
export const DESKTOP_PROTOCOL = 1;

export const APK_PATH = 'asahi.apk';
export const REPO_URL = 'https://github.com/wonderhoy-labs/asahi';
export const RELEASES_URL = `${REPO_URL}/releases`;
