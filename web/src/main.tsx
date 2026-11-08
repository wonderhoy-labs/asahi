import "@fontsource-variable/roboto-flex";
import "mdui/mdui.css";
import "mdui/components/button.js";
import "mdui/components/button-icon.js";
import "mdui/components/chip.js";
import "mdui/components/circular-progress.js";
import "mdui/components/dialog.js";
import "mdui/components/linear-progress.js";
import "mdui/components/text-field.js";
import "@mdui/icons/arrow-downward.js";
import "@mdui/icons/arrow-upward.js";
import "@mdui/icons/check.js";
import "@mdui/icons/check-circle.js";
import "@mdui/icons/close.js";
import "@mdui/icons/delete-outline.js";
import "@mdui/icons/desktop-access-disabled.js";
import "@mdui/icons/desktop-windows.js";
import "@mdui/icons/dns.js";
import "@mdui/icons/download.js";
import "@mdui/icons/error-outline.js";
import "@mdui/icons/fullscreen.js";
import "@mdui/icons/history.js";
import "@mdui/icons/info.js";
import "@mdui/icons/install-mobile.js";
import "@mdui/icons/lan.js";
import "@mdui/icons/lock.js";
import "@mdui/icons/open-in-new.js";
import "@mdui/icons/power-settings-new.js";
import "@mdui/icons/public.js";
import "@mdui/icons/refresh.js";
import "@mdui/icons/rocket-launch.js";
import "@mdui/icons/search.js";
import "@mdui/icons/upload-file.js";
import "@mdui/icons/usb.js";
import "@mdui/icons/verified-user.js";
import "@mdui/icons/volume-off.js";
import "@mdui/icons/volume-up.js";
import "@mdui/icons/vpn-key.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "./ui/theme.css";
import "./ui/wonderhoy.css";
import "./ui/styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
