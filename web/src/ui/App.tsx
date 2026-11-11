import { useSyncExternalStore } from "react";
import { Controller } from "../asahi/controller";
import { AppBar } from "./Brand";
import { Live } from "./Live";
import { Onboarding } from "./Onboarding";

// Only one, because it listens for USB and page events for as long as the page is open.
const controller = new Controller();

export function App() {
	const state = useSyncExternalStore(controller.subscribe, controller.getState);
	if (state.step === "live") return <Live controller={controller} state={state} />;
	return (
		<div className="app">
			<AppBar logo="./logo.webp" />
			<Onboarding controller={controller} state={state} />
		</div>
	);
}
