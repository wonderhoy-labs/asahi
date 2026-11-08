import { useSyncExternalStore } from 'react';
import { REPO_URL } from '../asahi/constants';
import { Controller } from '../asahi/controller';
import { Live } from './Live';
import { Onboarding } from './Onboarding';

// Only one, because it listens for USB and page events for as long as the page is open.
const controller = new Controller();

export function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  if (state.step === 'live') return <Live controller={controller} state={state} />;
  return (
    <div className="app">
      <header className="app-bar">
        <img className="app-bar-logo" src="./logo.webp" alt="" />
        <span className="app-bar-title">Asahi</span>
        <span className="app-bar-space" />
        <mdui-button variant="text" href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub
          <mdui-icon-open-in-new slot="end-icon" />
        </mdui-button>
      </header>
      <Onboarding controller={controller} state={state} />
    </div>
  );
}
