/// <reference types="mdui/jsx.en.d.ts" />
import type React from 'react';

type IconProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { slot?: string };

declare global {
  namespace React {
    namespace JSX {
      interface IntrinsicElements {
        [icon: `mdui-icon-${string}`]: IconProps;
      }
    }
  }
}

declare global {
  /** The version in VERSION, which the app and this page share. */
  const __ASAHI_VERSION__: string;
  const __ASAHI_VERSION_CODE__: number;
}
