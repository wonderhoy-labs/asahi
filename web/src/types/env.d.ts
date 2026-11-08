/// <reference types="mdui/jsx.en.d.ts" />
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type IconProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { slot?: string };

// mdui types its components for JSX, but not the icons from @mdui/icons.
declare module "react" {
	namespace JSX {
		interface IntrinsicElements {
			[icon: `mdui-icon-${string}`]: IconProps;
		}
	}
}

declare global {
	/** Asahi's own version, from VERSION. */
	const __ASAHI_VERSION__: string;
	/** The version of Shira's app that this page carries, from @wonderhoy-labs/shira. */
	const __SHIRA_VERSION__: string;
	const __SHIRA_VERSION_CODE__: number;
}
