import type { Setup, Source } from "../asahi/sources";
import { setupOf } from "../asahi/sources";

/** The icon for what the tab shows, the same in the onboarding and the live view's menu. */
export function SourceIcon({ source, slot }: { source: Source; slot?: string }) {
	return <SetupIcon setup={setupOf(source)} slot={slot} />;
}

export function SetupIcon({ setup, slot }: { setup: Setup; slot?: string }) {
	switch (setup) {
		case "android-desktop":
			return <mdui-icon-desktop-windows slot={slot} />;
		case "android-screen":
			return <mdui-icon-stay-current-portrait slot={slot} />;
		case "android-app":
			return <mdui-icon-android slot={slot} />;
		case "linux-app":
			return <mdui-icon-web-asset slot={slot} />;
		case "linux-desktop":
			return <mdui-icon-computer slot={slot} />;
		case "linux-console":
			return <mdui-icon-terminal slot={slot} />;
	}
}
