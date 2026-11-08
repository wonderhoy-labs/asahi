<p align="center">
  <img src="docs/logo.webp" alt="" width="180">
</p>

<h1 align="center">Asahi</h1>

<p align="center">Your Pixel's desktop in a browser tab, online through the same cable.</p>

<p align="center">
  <a href="https://github.com/wonderhoy-labs/asahi/actions/workflows/ci.yml"><img src="https://github.com/wonderhoy-labs/asahi/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache 2.0"></a>
  <a href="#license-and-credits"><img src="https://img.shields.io/badge/Asahina%20Mafuyu-25--ji%2C%20Nightcord%20de.-8888CC" alt="Named for Asahina Mafuyu of 25-ji, Nightcord de."></a>
</p>

Asahi puts your phone's desktop in a web page, and gets the phone online through that same page. You plug your phone into a
computer, open the page in Chrome, and use Android's own desktop mode with your mouse and keyboard, while everything the phone
does goes down the cable and out through a [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) server. It works with the
phone's Wi-Fi and mobile data turned off.

There's no root on the phone, and no `adb`, drivers or anything else on the computer. It's
[Shira](https://github.com/wonderhoy-labs/shira) and [Shinonome](https://github.com/wonderhoy-labs/shinonome) in one app and one
page.

![Asahi in Chrome, showing a Pixel's desktop with two windows open](docs/screenshot.webp)

> **This is early.** We've tested it on one Pixel 10 Pro running Android 17 with a Mac, and on an Android 17 emulator.
> [Here's exactly what that covers](#what-has-been-tested), including the parts we couldn't test yet. If you try anything else,
> please [open an issue](https://github.com/wonderhoy-labs/asahi/issues) and tell us how it went, even if it just worked.

## What you need

- A phone whose Android build can put the desktop on a virtual display. Android 17 on the Pixel 10 Pro can. If yours gets
  refused, turn on **Enable desktop experience features** in Developer options and reboot. Phones that can't still get the
  network part, on Android 10 or newer.
- **USB debugging** turned on in Developer options, and a USB cable that carries data.
- A computer with Chrome, Edge or another Chromium browser. Safari and Firefox don't have WebUSB.
- A Wisp server. [Here's what to look for.](#wisp-servers)

## Use it

Open **<https://wonderhoy-labs.github.io/asahi/>** and follow the five steps. Nothing happens to your phone until you click
something.

![Asahi's setup page, at the step for picking a Wisp server](docs/onboarding.webp)

1. **Connect your phone.** Plug it in, click **Connect phone** and pick it from the browser's list.
2. **Allow USB debugging.** Unlock the phone. If it asks whether to allow USB debugging, tick **Always allow from this
   computer** and tap **Allow**. A browser you've allowed before carries on by itself.
3. **Pick a Wisp server,** like `wss://example.com/wisp/`. The page connects to it once to check, and asks for a login if the
   server wants one. It remembers the last few you used.
4. **Install the app.** The page shows whether it's there and which version. **Install it for me** does it through USB
   debugging, **I'll install it myself** gives you the APK and notices when it's on the phone, and **Check again** looks again.
   If the app's already current, **Continue** carries on. You can also get it from
   [Releases](https://github.com/wonderhoy-labs/asahi/releases).
5. **Launch.** This turns on the network, connects it to your server, starts the desktop and opens it. The page gives the app
   Android's VPN permission through USB debugging, the same as tapping OK on the phone's own dialog.

Then you're in. The bar at the top shows the desktop's frame rate and delay, and the network's speed. Click the network to see
every connection your phone makes. **Fullscreen** gives the desktop the whole screen, and you hold Esc to leave.

Only one program can use USB debugging at a time, so if you have `adb` on this computer, stop it first. Close Android Studio
and any WebADB tabs too.

```bash
adb kill-server
```

Keep the tab open. It carries both the desktop and the network, so closing it takes your phone off the network within about 10
seconds, and the desktop ends by itself after 2 minutes. If the cable comes out, plug it back in and the page carries on.

To stop, click **End session**. The desktop's windows go back to the phone, the phone goes back to its own network, and USB
debugging is free for other tools again.

### While a session runs

The desktop takes the shape of your browser window, up to about 1920x1200, so there are no bars around it. Opening the network
panel gives the panel its own room, and the desktop reshapes to fit what's left.

Your phone's screen turns off when the desktop connects, and the phone stays awake and unlocked behind it. You can still lock it
with the power button. The desktop keeps going, and pressing the button again shows the lock screen so you can use your phone.
When the session ends, the phone locks if its screen was off.

Keys are sent by position, as on a US keyboard. On a Mac, Cmd acts as Ctrl, because that's what Android's shortcuts expect.

### The network log

Every connection gets a row, newest first, with the app that made it, the destination, its status and how much went each way.
Click one for the details. You can search by name, address, app or port, filter by what's active, failed, DNS or UDP, and save
the whole log as JSON.

The log only exists in that tab. It's never sent anywhere, and it's gone when you close it.

## Wisp servers

A Wisp server turns a WebSocket into TCP and UDP connections. All your phone's traffic goes through it, so use one you run
yourself or trust. [wisp-js](https://github.com/MercuryWorkshop/wisp-js) and
[epoxy-server](https://github.com/MercuryWorkshop/epoxy-tls) are two you can host.

From a site served over HTTPS, as the official page is, the browser only allows `wss://` addresses, apart from `ws://localhost`.

Asahi needs these from a server:

- **Connections to IP addresses.** The phone asks 1.1.1.1 for addresses, and apps connect to those. A server with
  `allow_direct_ip` turned off, as wisp-js calls it, refuses everything.
- **TCP to port 53 on 1.1.1.1**, for DNS.
- **UDP, if you want it.** Without it, apps that try QUIC are told straight away that it won't work, and they fall back to TCP.

It speaks Wisp version 2, and falls back to version 1. It shows a server's welcome message on the Launch step. For logins it does
the password extension, which it only ever sends to a server that asked for it. The password stays in the tab's memory, so you
enter it again after a reload. Key-based logins aren't supported.

> **If you host wisp-js:** in the npm release, when a destination closes a connection, the server throws away whatever it hasn't
> sent on yet, so a fast download can get cut short with no error. The `fixes` branch of
> [our fork](https://github.com/wonderhoy-labs/wisp-js/tree/fixes) fixes that, and epoxy-server is another way around it.

## What has been tested

Everything here is on a Pixel 10 Pro running Android 17 (build `CP3A.260905.009`, not rooted), with a Mac.

**The whole page, in Chrome 156 and through the development server's link to `adb`.** That's the real page and the real app,
reaching the phone through the `adb` server on the Mac instead of WebUSB:

- Connecting, finding no app, **Install it for me** with the release APK, then finding it installed on the next visit.
- Checking a Wisp server, and **Launch**: the VPN came up, the desktop started, and the page showed it at 90 to 119 frames per
  second while windows changed, with 29 to 53 ms from capture to decoded by the page's own count.
- With the phone's Wi-Fi off and no mobile service, Wikipedia loaded in Chrome on the phone's desktop. The network log showed
  Chrome's QUIC and the phone's DNS lookups.
- Clicks, typing, Cmd+A and Enter on the desktop, opening apps from its taskbar, and reshaping the desktop when the network panel
  opens and closes.
- Updating the app during a session: the page said the network had stopped, the desktop kept going, and turning it back on
  from the page brought the network back.
- Reloading the page during a session and launching again picked up the running desktop, with its windows where they were.
- **End session** stopped the desktop server and the VPN, and left the phone as it was before.

**Real USB, through the same WebUSB code outside a browser.** Tango's WebUSB backend, which the page uses, ran in Node with
[node-usb](https://github.com/node-usb/node-usb) in place of the browser's WebUSB. The phone asked about the new key, and after
Allow the desktop started, took a new shape and streamed with no dropped frames, while a 256 MiB download ran on the same
connection at 137 Mbit/s. Stopping it ended the server.

**On an Android 17 emulator,** the network came up and the page explained that the emulator can't make a desktop, with the
network still working. The app's own screen was checked there in light and dark.

**Not tried yet:** picking the phone in a browser's own WebUSB list, which needs a person to click it, so the whole flow hasn't
run over WebUSB inside a browser. Also replugging the cable, the screen turning off during a session (our test sessions kept it
on so that the phone wouldn't lock, though that code is Shinonome's and was tested there), password logins, other phones,
Windows, Linux and Edge.

## How it works

```
                 apps on the phone                       the desktop
                        │ IP packets                          │ Android's own desktop mode
                        ▼                                     ▼
   Asahi app: VPN, with TCP, UDP and DNS ending here     virtual display ── H.264 encoder
                        │ Wisp packets                        │ (desktop server, shell user)
                        ▼                                     ▼
           localabstract:asahi                    localabstract:asahi-desktop
                        └────────────── adb over USB ─────────┘
                                          │
                               the page, over WebUSB
                        ┌─────────────────┴─────────────────┐
              wisp-js to your Wisp server         WebCodecs to a canvas
                        │                                   ▲
                   the internet                  your mouse and keyboard
```

The page speaks `adb` over WebUSB with [Tango](https://github.com/yume-chan/ya-webadb), the library behind WebADB. One `adb`
connection carries everything: a socket to the app for the network, a socket to the desktop server, and the shell commands that
install and start things. Both sockets are described in [docs/protocol.md](docs/protocol.md).

### The network

This is Shira. Normal apps can't use a phone's USB port as a network, but they can be a VPN, which receives every packet the
phone sends. Asahi's app does that and ends the connections right there, in a small TCP stack written in Kotlin that acts as the
other end of every connection and turns each one into a Wisp stream. The page hands those to
[wisp-js](https://github.com/MercuryWorkshop/wisp-js), which keeps the connection to your server.

The app has no INTERNET permission, so its only way out is the cable. The VPN only exists while the page is attached and
connected to a Wisp server. Android is told the VPN is a real network, so apps don't think they're offline when there's nothing
else.

DNS goes to a resolver that exists only inside the app. It answers from a small cache, or asks `1.1.1.1` over a Wisp TCP stream.
The VPN is IPv4 only.

### The desktop

This is Shinonome. Android decides whether a display gets the desktop by how the display was created, not by whether there's a
real monitor. A virtual display with the `TRUSTED` and `ALLOWS_CONTENT_MODE_SWITCH` flags gets the taskbar, title bars and window
management like a monitor you just plugged in. Asahi doesn't reimplement any of that.

Normal apps can't create a trusted display, but the shell user that `adb` runs as can. So the APK also contains a small server,
and the page starts it with `app_process` through `adb`, using the app's start script. The server creates the display, encodes it
with the phone's H.264 encoder at low-latency settings, and injects your input into it. The page decodes with WebCodecs and draws
to a canvas.

A virtual display shares the phone's power state, so the desktop would go blank as soon as the phone slept. During a session the
server wakes the phone whenever it sleeps and turns off only its screen.

When the desktop ends, Android moves its windows back to the phone. They come back to the same places next time.

## Security and privacy

Worth reading before you use this.

**The page has the same access as `adb`.** Code on it can do anything `adb` can on the phone you connect, including installing
apps, so only use the address above or a copy you host yourself. It runs nothing from elsewhere, and its content security policy
keeps it that way. The key your phone trusts stays in that browser's profile. To take that trust back, use **Revoke USB debugging
authorizations** in Developer options.

**While the desktop runs, whoever has the page can use your apps without your PIN,** even with the phone locked. That's the
trade-off for only unlocking once. It ends when you end the session, close the tab or unplug for more than 2 minutes.

**The Wisp server carries all your phone's traffic.** It sees where your phone connects and anything that isn't encrypted,
including your DNS questions. HTTPS is still HTTPS. Asahi adds no encryption of its own past the `wss://` to the server, and a
`ws://` address has none at all. 1.1.1.1 sees your DNS questions too.

**Other apps on the phone are kept out.** The app's socket and the desktop server's socket both refuse connections from anything
but `adbd`. Any app could listen on those names first, so the page only connects once it has
checked that Asahi's own service, or its own server, holds them. Only `adb` can open the screen that turns the network on.

**Launching gives the app the VPN approval,** the same as the phone's dialog would. It stays until you uninstall the app, like
any VPN's. It also grants the notification permission, so that you can see it's running. Asahi replaces any other VPN while
it's on, and that one doesn't come back by itself.

## Troubleshooting

**Your phone isn't in the browser's list.** Check that USB debugging is on and that the cable carries data. The list only shows
devices with an `adb` connection.

**"Something else on this computer is using USB debugging".** Only one program can use it at a time. Close any WebADB tabs, quit
Android Studio, and run `adb kill-server`, because other tools can start `adb` again by themselves.

**It stays on "Allow USB debugging".** Unlock the phone. If the prompt never comes, unplug the cable and plug it in again.

**"Your phone can't make a desktop".** Your Android build doesn't extend the desktop to virtual displays. Try turning on **Enable
desktop experience features** in Developer options and rebooting. The network works either way.

**The app won't install.** Play Protect may ask about it, because it's not from the Play Store. The page tells you Android's
reason if it's anything else. **"Signed with a different key"** means you have a copy from somewhere else, like your own build.
Remove it with the button on the page.

**Launch stays on "Turn on the network".** Unlock the phone, because a locked phone can't open the app. If it's asking about a VPN
connection, tap **OK**. If another app is set as an always-on VPN, turn that off in Settings, under Network & internet, then VPN.

**Pages don't load, but the log shows connections failing.** Click a few rows. "Blocked by the server" means it refuses that
address or port, and the [server's needs](#wisp-servers) above are a good place to start. If DNS rows fail, it can't reach
`1.1.1.1:53`.

**Windows have no title bars and you can't drag them.** Another virtual desktop is running, like Shinonome's on the phone itself.
Asahi ends Shinonome's computer sessions when it starts, but not the desktop in Shinonome's app. Close that and launch again.

If you're reporting a bug, please include your phone model, Android build number, browser version and which Wisp server software
you're using. The JSON you can save from the log can help, but look through it first, because it lists everywhere your phone
connected.

## Known issues

- `ping` doesn't work, because Wisp only carries TCP and UDP. Apps that check connectivity by pinging may say they're offline.
- No IPv6. An IPv6 attempt would look like it worked and then fail, instead of falling back the way apps normally do.
- An app's connection looks like it succeeded before the server has tried it, because Wisp doesn't confirm connections.
- Wisp has no half-close, so a server that waits for the app to finish sending before it answers won't answer.
- Traffic to your local network goes to the Wisp server too, which usually refuses it.
- No sound and no shared clipboard from the desktop.
- Keys go by position, so non-US layouts type the wrong characters.
- Touch on the desktop hasn't been tried.

## Development

You need Node 24 or newer with pnpm, JDK 17 or newer, and the Android SDK with platform 37. On Windows, use `gradlew.bat`.

Asahi follows the [Wonderhoy Labs guideline](.claude/skills/wonderhoy-unification/SKILL.md), like every Wonderhoy Labs project.
The shared tools need Node 24 or newer and pnpm. Format before you commit, and check the result:

```bash
pnpm install && pnpm format && pnpm unify
```

| Where | What's in it |
| --- | --- |
| `android/app/src/main/kotlin/com/wonderhoylabs/asahi/tunnel/` | The TCP, UDP and DNS side of the network, with nothing Android-specific so that it can be tested on its own |
| `android/app/src/main/kotlin/com/wonderhoylabs/asahi/bridge/` | The messages on the network socket |
| `android/app/src/main/kotlin/com/wonderhoylabs/asahi/vpn/` | The VPN service, and the thread that moves everything |
| `android/app/src/main/kotlin/com/wonderhoylabs/asahi/ui/` | The app's screen |
| `android/app/src/main/java/com/wonderhoylabs/asahi/server/` | The desktop server: display, encoder, input and the desktop socket |
| `android/app/src/main/assets/start.sh` | Starts the desktop server as the shell user. The page carries the same file |
| `web/src/asahi/controller.ts` | Everything the page does, step by step |
| `web/src/adb/` | Reaching the phone, and what's done on it |
| `web/src/link/`, `web/src/wisp/`, `web/src/log/` | The network: its socket, the Wisp connection and the log |
| `web/src/desktop/` | The desktop: video, input and its socket |
| `web/src/ui/` | The page's screens, in React with [mdui](https://github.com/zdhxiong/mdui) for Material 3 |
| `web/plugins/` | The Vite plugin: the APK, and the development servers |
| `VERSION` | The version, for both the app and the page |
| `tools/` | The shared Wonderhoy Labs tools: `theme.ts` makes the colours, `unify.ts` checks the guideline |

Build the app, then start the page:

```bash
cd android && ./gradlew :app:assembleDebug
```

```bash
pnpm install && cd web && pnpm dev
```

The development server does a few things production gets from elsewhere:

- **It runs a Wisp server** at `/wisp/` on the same port, and the page starts with that address filled in. It can reach this
  computer's own services too, so it only takes connections from this page. To try logins, set
  `ASAHI_DEV_WISP_AUTH=user:password` before you start it.
- **It serves the debug APK.** Set `ASAHI_APK` to a path to serve another.
- **It can reach `adb`.** The page also lists whatever your `adb` server can see, which is how to use an emulator, or a phone
  without stopping `adb`. An emulator can test everything but the desktop, which it refuses because it has no desktop windows.

To keep the phone's screen on during a development session, so that ending it doesn't lock the phone, run this in the page's
console. Anything in it is passed to the desktop server, and production builds ignore it.

```js
localStorage.setItem('asahi.dev.desktop-args', '--screen-on')
```

A production build needs a release APK, because the site carries it. Preview serves that build with the same Wisp server, at
`ws://localhost:4173/wisp/`.

```bash
cd android && ./gradlew :app:assembleRelease
```

```bash
cd web && pnpm build && pnpm preview
```

Tests:

```bash
cd android && ./gradlew :app:testDebugUnitTest
```

```bash
cd web && pnpm test
```

`ScreenTest` draws every state of the app's screen and saves pictures. Run it on an emulator with `am instrument`, because Gradle's
connected task uninstalls the app, and its pictures with it:

```bash
cd android && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest
```

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk && adb install -r -t app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
```

```bash
adb shell am instrument -w com.wonderhoylabs.asahi.test/androidx.test.runner.AndroidJUnitRunner
```

The pictures end up in `/sdcard/Android/data/com.wonderhoylabs.asahi/files/screens/`.

Release APKs are signed with your debug key unless you set `ASAHI_KEYSTORE`, `ASAHI_KEYSTORE_PASSWORD`, `ASAHI_KEY_ALIAS` and
`ASAHI_KEY_PASSWORD`.

Pushing to `main` builds everything through [ci.yml](.github/workflows/ci.yml) and publishes the site to GitHub Pages, whose source
has to be GitHub Actions. Pushing a tag like `v0.1.0`, matching `VERSION`, builds everything and publishes a GitHub release through
[ci.yml](.github/workflows/ci.yml). It signs the APK with the repository's `ASAHI_KEYSTORE_BASE64`, `ASAHI_KEYSTORE_PASSWORD`,
`ASAHI_KEY_ALIAS` and `ASAHI_KEY_PASSWORD` secrets. Without them, each release gets a throwaway key and has to be installed
fresh instead of updating.

## License and credits

Asahi is a [Wonderhoy Labs](https://github.com/wonderhoy-labs) project, released under the [Apache License 2.0](LICENSE). It isn't
affiliated with Google. Android and Pixel are trademarks of Google LLC.

It stands on the work of these projects:

- [wisp-js](https://github.com/MercuryWorkshop/wisp-js) and the [Wisp protocol](https://github.com/MercuryWorkshop/wisp-protocol), by
  Mercury Workshop. wisp-js is under the GNU LGPL 3.0 or later. The page and its development server use
  [our fork](https://github.com/wonderhoy-labs/wisp-js/tree/fixes), which is upstream with two fixes. To use another version, change
  it in `web/package.json` and rebuild.
- [Tango](https://github.com/yume-chan/ya-webadb) (MIT), by Simon Chan, for `adb` over WebUSB
- [scrcpy](https://github.com/Genymobile/scrcpy). The process setup in
  `android/app/src/main/java/com/wonderhoylabs/asahi/server/Hidden.java` is adapted from its `Workarounds` and `FakeContext` classes,
  under the Apache License 2.0. Copyright (C) 2018 Genymobile, Copyright (C) 2018-2026 Romain Vimont.
- [mdui](https://github.com/zdhxiong/mdui) (MIT), for the page's Material 3 components, and
  [Material Color Utilities](https://github.com/material-foundation/material-color-utilities) (Apache 2.0), which made its colours
- [React](https://github.com/facebook/react) (MIT) and [TanStack Virtual](https://github.com/TanStack/virtual) (MIT)
- [Roboto Flex](https://github.com/googlefonts/roboto-flex) (OFL 1.1), through [Fontsource](https://github.com/fontsource/fontsource)
- [Jetpack Compose and AndroidX](https://developer.android.com/jetpack) (Apache 2.0), for the Android app

The site publishes everything it bundles, with license texts, as `third-party-licenses.txt`.

Asahi is named for Asahina Mafuyu of 25-ji, Nightcord de., from Project SEKAI COLORFUL STAGE! feat. Hatsune Miku. Wonderhoy Labs is a
fan project, not affiliated with SEGA, Colorful Palette or Crypton Future Media, who own Project SEKAI and its characters.
The Apache License doesn't cover the Asahi name or logo.
