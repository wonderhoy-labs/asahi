import { Phone as DesktopPhone } from "@wonderhoy-labs/shinonome";
import { type LinkApp, Phone as NetworkPhone, type PhoneKind } from "@wonderhoy-labs/shira";
import type { Adb } from "@yume-chan/adb";

export type { PhoneKind };

/**
 * A phone reached through adb, seen two ways: through Shira's library for its network and the app that provides it
 * (Shira's or Shiho's), and through Shinonome's for its desktop. All of it talks over the same adb connection.
 */
export class Phone {
	network: NetworkPhone;
	readonly desktop: DesktopPhone;

	constructor(
		readonly adb: Adb,
		readonly name: string,
		readonly kind: PhoneKind,
	) {
		this.network = new NetworkPhone(adb, name, kind);
		this.desktop = new DesktopPhone(adb, name);
	}

	/** Talks to another app for the network, such as Shiho's instead of Shira's. */
	switchNetworkApp(app: LinkApp) {
		if (this.network.app.package !== app.package)
			this.network = new NetworkPhone(this.adb, this.name, this.kind, app);
	}

	get disconnected(): Promise<unknown> {
		return this.adb.disconnected;
	}

	shell(command: string): Promise<string> {
		return this.network.shell(command);
	}

	async close(): Promise<void> {
		await this.adb.close();
	}
}
