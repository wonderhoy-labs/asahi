# AGENTS.md

Read the Wonderhoy Labs unification skill, [.claude/skills/wonderhoy-unification/SKILL.md](.claude/skills/wonderhoy-unification/SKILL.md),
before changing anything. It's the same in every Wonderhoy Labs repository. This file only adds what's particular
to Asahi.

## What Asahi is

Your whole phone from a web page, over one USB cable and WebUSB: Android's desktop, its screen, any one of its apps, Linux apps
through Airi and Minori's machines, while the phone gets online through a Wisp server. It's the Wonderhoy Labs projects' web
front, built on their libraries, `@wonderhoy-labs/shira`, `@wonderhoy-labs/shinonome` and `@wonderhoy-labs/minori`, and has
no Android code of its own: the phone runs Shira's app for the network, and Shinonome's server, which the page copies to the
phone and starts as the shell user without installing it. `web/src/asahi/sources.ts` lists what the tab can show and decides
which the phone can do. Named for Asahina Mafuyu of 25-ji, Nightcord
de. The site is at <https://wonderhoy-labs.github.io/asahi/>.

## Layout

| Path | What |
| --- | --- |
| `web/src/asahi/controller.ts` | Everything the page does, step by step, on the two libraries |
| `web/src/asahi/sources.ts`, `minori.ts`, `airi.ts` | What the tab can show, Minori's machines, and Airi's apps |
| `web/src/adb/` | WebUSB and the development adb server, and `Phone`, which pairs Shira's and Shinonome's phone helpers |
| `web/src/ui/` | The onboarding and the live view |
| `web/plugins/` | The Vite plugin: the carried Shira version, the notices, and the development Wisp and adb servers |

## Build, test and format

```bash
pnpm install && pnpm unify
cd web && pnpm test && pnpm build
```

## Things to know

- **Fix things in the libraries, not here.** The network is Shira's and the desktop is Shinonome's. If Asahi needs one
  to do something new, change that library, release it, and move the address in `web/package.json`. Never copy their code
  back in.
- **The libraries come from their GitHub releases**, by tarball address in `web/package.json`, and carry the APKs the
  page installs and runs. `__SHIRA_VERSION_CODE__` comes from the installed Shira library, so the app step asks for
  exactly the Shira it carries.
- **wisp-js comes from the fork** `wonderhoy-labs/wisp-js`, pinned by commit in `web/package.json`. Shira's library needs it
  as a peer, because pnpm won't fetch a dependency's git dependencies. Keep the pin the same as Shira's.
- **The onboarding order is the maintainer's**: USB, allow debugging, Wisp server, install only on request, Launch. The
  last step holds the choice of what to show, and only offers what the connected phone can do, saying why for the rest.
- **Word it as the whole phone, not as Shira plus Shinonome.** The tagline is in `package.json`; `pnpm theme` spreads it.
- **WebUSB was never tested end to end in a browser**, because Chrome's device chooser needs a human click. Say so
  until someone has.
- **On the PIN-locked test phone**, set `localStorage['asahi.dev.desktop-args'] = '--screen-on'` for dev sessions,
  or ending a session locks the phone.
- **Test sessions in real Chrome.** Before Shira 0.2.1, ending a session with apps connected crashed the tab: Chrome
  crashed when the Wisp connection closed in the same task as the streams' last writes, which looked like the page
  no longer answering DevTools. Shira 0.2.1 fixed that in real Chrome. The Claude app's built-in browser pane crashed
  its renderer when a session ended too, and hasn't been tried since.
- **Asahi 0.1.0 had its own app**, `com.wonderhoylabs.asahi`, signed with the key behind the `ASAHI_*` secrets. Nothing
  builds it now, but never replace or delete that key or those secrets.

## Exceptions to the guideline

- The live desktop view fills the whole window and leaves out the shared bar, which comes back with the onboarding
  screen.
- There's no `android/`, and no library of Asahi's own: it's made of Shira's and Shinonome's.
