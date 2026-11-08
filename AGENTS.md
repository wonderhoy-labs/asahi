# AGENTS.md

Read the Wonderhoy Labs unification skill, [.claude/skills/wonderhoy-unification/SKILL.md](.claude/skills/wonderhoy-unification/SKILL.md),
before changing anything. It's the same in every Wonderhoy Labs repository. This file only adds what's particular
to Asahi.

## What Asahi is

Shira and Shinonome in one web page. Over one USB cable and WebUSB, it shows the Pixel's desktop in a browser tab
and gets the phone online through a Wisp server. The APK is Shira's VPN app plus Shinonome's desktop server (USB
only: no Shizuku, TLS or pairing), which the page starts as the shell user from the installed APK. Sockets are
`localabstract:asahi` for the network and `localabstract:asahi-desktop` for the desktop. Named for Asahina Mafuyu
of 25-ji, Nightcord de. The site is at <https://wonderhoy-labs.github.io/asahi/>.

## Layout

| Path | What |
| --- | --- |
| `android/app/src/main/kotlin/com/wonderhoylabs/asahi/` | The VPN, tunnel and app screen, in Kotlin |
| `android/app/src/main/java/com/wonderhoylabs/asahi/server/` | The desktop server, in Java, run through `app_process` |
| `web/src/desktop/` | Decoding and drawing the desktop, and its input |
| `web/src/link/`, `web/src/wisp/` | The network relay to the Wisp server |
| `web/src/asahi/controller.ts` | Everything the page does, step by step |
| `web/plugins/` | The Vite plugin: the APK, the notices, and the development Wisp and adb servers |

## Build, test and format

```bash
pnpm install && pnpm unify
cd android && ./gradlew spotlessApply :app:testDebugUnitTest :app:lintRelease :app:assembleRelease
cd web && pnpm test && pnpm build
```

The site's build carries the release APK, so build the app first.

## Things to know

- **The onboarding order is the maintainer's**: USB, allow debugging, Wisp server, install only on request, Launch.
- **WebUSB was never tested end to end in a browser**, because Chrome's device chooser needs a human click. Say so
  until someone has.
- **On the PIN-locked test phone**, set `localStorage['asahi.dev.desktop-args'] = '--screen-on'` for dev sessions,
  or ending a session locks the phone.
- **Test sessions in real Chrome.** The Claude app's built-in browser pane crashes its renderer when a session
  ends over the dev adb-server path.
- wisp-js comes from the fork `wonderhoy-labs/wisp-js`, pinned by commit, as in Shira.
- **The desktop messages are Shinonome's.** A change to the messages, sound, clipboard or encoder belongs in both, and
  each bumps its protocol number. Shinonome's `pnpm measure --features` checks the same server code against a phone.
- **The Pixel's encoder ignores any operating rate above 480**, so `Encoder.MAX_OPERATING_RATE` caps it.
- **React Native apps such as Discord draw clipped text** unless the desktop's density equals the phone's. Sharp mode
  (`RESIZE_SHARP`) gives the desktop the phone's density and costs about 10 ms. Keep it opt-in.
- The desktop server's process setup is adapted from scrcpy, under the Apache License 2.0. Keep its notice.
- Never replace the Android signing key. CI signs with the `ASAHI_KEYSTORE_BASE64`, `ASAHI_KEYSTORE_PASSWORD`,
  `ASAHI_KEY_ALIAS` and `ASAHI_KEY_PASSWORD` secrets.

## Exceptions to the guideline

- The live desktop view fills the whole window and leaves out the shared bar and footer, which come back with the
  onboarding screen.
