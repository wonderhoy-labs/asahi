import { Phone as DesktopPhone } from "@wonderhoy-labs/shinonome";
import { Phone as NetworkPhone, type PhoneKind } from "@wonderhoy-labs/shira";
import type { Adb } from "@yume-chan/adb";

export type { PhoneKind };

/**
 * A phone reached through adb, seen two ways: through Shira's library for its network and the app that provides it,
 * and through Shinonome's for its desktop. Both talk over the same adb connection.
 */
export class Phone {
	readonly network: NetworkPhone;
	readonly desktop: DesktopPhone;

	constructor(
		readonly adb: Adb,
		readonly name: string,
		readonly kind: PhoneKind,
	) {
		this.network = new NetworkPhone(adb, name, kind);
		this.desktop = new DesktopPhone(adb, name);
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
