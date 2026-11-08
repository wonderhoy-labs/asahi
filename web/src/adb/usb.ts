import { Adb, AdbDaemonTransport, type AdbDaemonConnection } from '@yume-chan/adb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { AdbDaemonWebUsbDevice, AdbDaemonWebUsbDeviceManager } from '@yume-chan/adb-daemon-webusb';
import { Phone } from './phone';

/**
 * How much may be on its way on each socket before adb waits for the page to read it. Video queued here
 * is old by the time it's shown, and the phone can only skip ahead once this fills, so it's kept modest.
 * Over a cable it still leaves the network link room for hundreds of megabits.
 */
const DELAYED_ACK_BYTES = 512 * 1024;

const manager = AdbDaemonWebUsbDeviceManager.BROWSER;

export const isUsbAvailable = manager !== undefined;

export type UsbConnection = AdbDaemonConnection;

/** Shows the browser's list of phones. Only works straight after a click. Null if nothing was picked. */
export async function pickPhone(): Promise<AdbDaemonWebUsbDevice | null> {
  return (await manager?.requestDevice()) ?? null;
}

/** A phone this site's already been allowed to use, if there's exactly one plugged in. */
export async function knownPhone(): Promise<AdbDaemonWebUsbDevice | null> {
  const devices = (await manager?.getDevices()) ?? [];
  return devices.length === 1 ? (devices[0] ?? null) : null;
}

export class UsbBusyError extends Error {
  constructor() {
    super(
      'Something else on this computer is using USB debugging. Close any other WebADB tabs, run "adb kill-server", and quit Android Studio if it\'s open.',
    );
    this.name = 'UsbBusyError';
  }
}

/** Claims the phone's adb interface. Nothing's asked on the phone yet. */
export async function claimUsb(device: AdbDaemonWebUsbDevice): Promise<UsbConnection> {
  try {
    return await device.connect();
  } catch (error) {
    if (error instanceof AdbDaemonWebUsbDevice.DeviceBusyError) throw new UsbBusyError();
    throw error;
  }
}

/** Logs in to adb, which is when the phone asks whether to allow this computer if it doesn't know it yet. */
export async function authorizeUsb(device: AdbDaemonWebUsbDevice, connection: UsbConnection): Promise<Phone> {
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: new AdbWebCredentialStore('Asahi'),
    initialDelayedAckBytes: DELAYED_ACK_BYTES,
  });
  return new Phone(new Adb(transport), device.name || 'Your phone', 'usb');
}
