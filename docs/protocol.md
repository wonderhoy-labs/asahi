# Asahi's links

The page talks to the phone over two `adb` sockets at once: one to the app for the network, and one to the desktop server for
the desktop. This is what goes over each, for anyone writing another client.

# The network link

Version 1. This is what goes between the app and the web page. The Kotlin version is in
[`Link.kt`](../android/app/src/main/kotlin/com/wonderhoylabs/asahi/bridge/Link.kt) and the TypeScript one is in
[`frames.ts`](../web/src/link/frames.ts). Their tests check the same bytes.

## The socket

The app listens on the abstract Unix socket `asahi`, and the page reaches it through `adb` by opening the service
`localabstract:asahi`. The app takes connections only from the shell user or root, which is what `adbd` runs as, so no other
app can see or inject traffic.

Only one page can be attached. A new connection replaces the old one, and the app tells the old one so that it doesn't try to
take the socket back.

## Packets

Everything on the socket is a [Wisp](https://github.com/MercuryWorkshop/wisp-protocol/blob/main/protocol.md) packet with its
length in front, because a socket has no message boundaries of its own the way a WebSocket does. Numbers are little-endian.

| Bytes | Value |
| --- | --- |
| 4 | Length of everything after this field, at most 1 MiB |
| 1 | Type |
| 4 | Stream ID. 0 for anything that isn't about a stream |
| n | Payload |

Types below `0x80` mean exactly what they mean in Wisp, and the page carries them on to the Wisp server through
[wisp-js](https://github.com/MercuryWorkshop/wisp-js). The others stay on the cable.

| Type | Name | From | Payload |
| --- | --- | --- | --- |
| `0x01` | CONNECT | App | Stream type in 1 byte, port in 2, then the destination as text |
| `0x02` | DATA | Both | Bytes |
| `0x03` | CONTINUE | Page | How many more packets the server can take on this stream, in 4 bytes |
| `0x04` | CLOSE | Both | Reason in 1 byte |
| `0x80` | HELLO | App | This protocol's version in 1 byte, then the app's version as text |
| `0x81` | START | Page | Packets the server can take per stream in 4 bytes, 1 byte that's nonzero if it allows UDP, then its name as text |
| `0x82` | STOP | Page | 1 byte that's nonzero if the service should stop too |
| `0x83` | STATUS | App | Code in 1 byte, then a message as text |
| `0x84` | META | App | See below |
| `0x85` | PING | Page | Nothing |

Skip packets with a type you don't know.

## How a session goes

1. The page connects, and the app sends HELLO straight away. If the protocol versions differ, the page tells you to install
   the app from the same site.
2. The page connects to the Wisp server, and sends START when it's ready. Until then the phone has no VPN, so its own network
   keeps working.
3. The app brings the VPN up and sends STATUS.
4. CONNECT, DATA and CLOSE flow for as long as it lasts.
5. If the Wisp connection drops, the page sends STOP and starts again from step 2 when it has a new one.

| Status | Name | Meaning |
| --- | --- | --- |
| 0 | Down | The VPN is down, because the page asked |
| 1 | Up | The VPN is up |
| 2 | Failed | Android wouldn't start the VPN, and the message says why |
| 3 | Off | Someone's turning Asahi off on the phone. The page must not turn it back on |
| 4 | Replaced | Another page took over. This one must not take it back |

The page sends PING every 2 seconds. A closed tab doesn't always close the socket, so if the app hears nothing for 10 seconds
it brings the VPN down and goes back to waiting.

## META

Tells the page about a stream for its log, right after the CONNECT.

| Bytes | Value |
| --- | --- |
| 4 | The Android user ID of the app that made the connection, or -1 if Android can't say |
| 1 | 0 for a connection, 1 for a DNS lookup |
| 2 | For a DNS lookup, the record type being asked for |
| n | The name being looked up, or the name that the destination's address came from, as text. It may be empty |

## Flow control

Going up, the app counts packets the way a Wisp client does. Each stream starts with the number in START, each DATA uses one,
and each CONTINUE sets a new number. wisp-js keeps its own count too and holds packets back if the two ever drift apart.

Coming down, Wisp has no way to slow one stream. The only brake is the whole connection, by not reading from it. When the app
is holding too much for apps that haven't read it yet, it stops reading the socket. `adb` then stops taking data from the page,
the page stops reading its WebSocket, and the server eventually stops reading from the internet. If an app has stopped reading
altogether while this is going on, like a paused video, it loses its connection so that it doesn't hold everything else up.

## DNS

Android is told to use a resolver at `10.219.0.2`, which nothing's behind. The app picks UDP packets to port 53 out of the
packet stream and answers from a small cache if it can. Otherwise, it opens one Wisp TCP stream per question to `1.1.1.1:53`,
using DNS's own TCP format, and closes it after the answer. A TCP stream works on every Wisp server, while UDP is optional, and
one per question keeps failures simple. A question gets a failure answer if the stream closes first, or after 5 seconds.

An answer that's too big for the client's UDP limit comes back truncated, and the client asks again over TCP. That connection
goes through to `1.1.1.1:53` like any other.

# The desktop link

Version 1. The desktop server listens on the abstract Unix socket `asahi-desktop`, and the page reaches it by opening
`localabstract:asahi-desktop`. The server is [`Server.java`](../android/app/src/main/java/com/wonderhoylabs/asahi/server/Server.java)
and the page's side is [`desktop-session.ts`](../web/src/desktop/desktop-session.ts). The messages are
[Shinonome's](https://github.com/wonderhoy-labs/shinonome), without its pairing code.

The server runs as the shell user, started by [`start.sh`](../android/app/src/main/assets/start.sh) from the installed APK. It
writes its log to `/data/local/tmp/asahi/server.log`, and the page only connects once that log has `protocol: 1` and `listening`
in it, so that another app holding the name first can't fool it. The server also refuses connections from anyone but the shell
user, which is what `adbd` runs as.

Each message is a 4-byte length, then a type byte and its fields. Unlike the network link, numbers here are big-endian.

| Type | Name | From | Fields |
| --- | --- | --- | --- |
| 1 | VIDEO | Server | Flags in 1 byte (1 is codec config, 2 is a key frame), capture, encode and send times in microseconds in 8 bytes each, then H.264 in Annex B form |
| 2 | STATUS | Server | JSON: `displayId`, `width`, `height`, `locked`, `usable`, `desktop`, `encoder` and `dropped` |
| 3 | PONG | Server | The PING's 8 bytes back, then the server's clock in microseconds in 8 bytes |
| 5 | READY | Server | 1 byte, always 1. Sent first, because `adb` has already vouched for the computer |
| 6 | REPLACED | Server | Nothing. Another page took the desktop, and this one must not take it back |
| 16 | MOUSE | Page | Action in 1 byte (0 move, 1 press, 2 release), button in 1 (1, 2 or 4), then x and y in 4 each |
| 17 | SCROLL | Page | x and y in 4 bytes each, then horizontal and vertical amounts as 4-byte floats |
| 18 | KEY | Page | Action in 1 byte (0 down, 1 up), Android keycode in 4, then Android meta state in 4 |
| 19 | PING | Page | The page's clock in microseconds, as an 8-byte float |
| 20 | STOP | Page | Nothing. Ends the desktop for good |
| 22 | KEY_FRAME | Page | Nothing. Asks for a key frame |
| 23 | RESIZE | Page | Width and height in 4 bytes each. The desktop takes that shape, between 480 and 2560 a side |

The page sends PING every 2 seconds. If the server hears nothing for 8 seconds it drops the connection, and if nobody connects
for 2 minutes it ends the desktop. The server keeps at most a few frames queued for a slow link, and skips to a fresh key frame
rather than fall behind.
