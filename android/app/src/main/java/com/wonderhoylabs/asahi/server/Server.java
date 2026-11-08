package com.wonderhoylabs.asahi.server;

import android.content.Context;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.net.LocalServerSocket;
import android.net.LocalSocket;
import android.os.Build;
import android.view.Display;

import androidx.annotation.RequiresApi;

import java.io.File;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * Runs one desktop session for the web page, which reaches it on a local socket through adb.
 *
 * Message format: one type byte, then big-endian fields. See web/src/desktop/protocol.ts for the other
 * side. The messages are Shinonome's, so the two stay easy to compare.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
final class Server {

	private static final int TYPE_VIDEO = 1;
	private static final int TYPE_STATUS = 2;
	private static final int TYPE_PONG = 3;
	private static final int TYPE_AUTH_RESULT = 5;
	private static final int TYPE_REPLACED = 6;
	private static final int TYPE_AUDIO = 7;
	private static final int TYPE_CLIPBOARD = 8;
	private static final int TYPE_MOUSE = 16;
	private static final int TYPE_SCROLL = 17;
	private static final int TYPE_KEY = 18;
	private static final int TYPE_PING = 19;
	private static final int TYPE_STOP = 20;
	private static final int TYPE_KEY_FRAME = 22;
	private static final int TYPE_RESIZE = 23;
	private static final int TYPE_AUDIO_CONTROL = 24;
	private static final int TYPE_SET_CLIPBOARD = 25;

	private static final int CLIPBOARD_PASTE = 1;

	private static final int AUTH_OK = 1;

	private static final int CLIENT_SILENCE_LIMIT_MS = 8_000;
	private static final int TICK_MS = 500;
	private static final int POWER_CHECK_MS = 100;
	private static final int PANEL_SETTLE_MS = 250;
	private static final int KEEP_AWAKE_TICKS = 4;
	private static final long FAREWELL_MS = 500;
	private static final int ELIGIBILITY_CHECK_TICK = 10;
	private static final String SOCKET_NAME = "asahi-desktop";
	/** The web page compares this with its own, and replaces a server it cannot talk to. */
	private static final int PROTOCOL = 2;
	private static final int MIN_DESKTOP_SIDE = 480;
	private static final int MAX_DESKTOP_SIDE = 2560;
	// Small, so a slow link makes us drop frames rather than buffer seconds of old video.
	private static final int SEND_BUFFER_BYTES = 192 * 1024;
	private static final int QUEUED_FRAMES = 6;
	private static final int SENDER_POLL_MS = 100;

	private final Context context;
	private final Options options;
	private final File dir;
	private final Object lock = new Object();
	private final KeepAlive keepAlive;

	private LocalServerSocket socket;

	// Guarded by lock.
	private VirtualDisplay display;
	private int displayId = Display.INVALID_DISPLAY;
	private Input input;
	private Session current;
	private long idleSince = System.currentTimeMillis();
	private boolean everConnected;
	private boolean screenOffApplied;
	private boolean panelDark;
	private Display phoneDisplay;
	private IdleSurface idleSurface;

	/** Null if this phone's clipboard service can't be reached. */
	private Clipboard clipboard;
	// Guarded by clipboardLock. What both sides last agreed the clipboard holds, so a change isn't sent back.
	private final Object clipboardLock = new Object();
	private String clipboardText;

	private volatile boolean stopping;
	private volatile boolean locked = true;
	private volatile boolean unlockedThisSession;
	private volatile boolean desktopEligible = true;

	Server(Context context, Options options) {
		this.context = context;
		this.options = options;
		this.dir = new File(options.dir);
		this.keepAlive = new KeepAlive(context);
	}

	/** Android creates the desktop only after an unlock, and input must not reach a phone locked before that. */
	private boolean isUsable() {
		return !locked || (options.keepRunningLocked && unlockedThisSession);
	}

	void run() throws IOException {
		String problem = DesktopDisplay.incompatibility(context);
		if (problem != null) {
			Log.info("incompatible: " + problem);
			return;
		}
		// Any app on the phone could take this name first. The web page only connects after reading
		// this server's log, so it can't be fooled that way.
		socket = new LocalServerSocket(SOCKET_NAME);
		Log.info("protocol: " + PROTOCOL);
		createDisplay();
		openClipboard();
		Log.info("listening");

		Thread keeper = new Thread(this::keepPhoneAwake, "keep-awake");
		keeper.setDaemon(true);
		keeper.start();
		Thread clients = new Thread(this::acceptClients, "clients");
		clients.setDaemon(true);
		clients.start();

		// stop() ends the process.
		watch();
	}

	private void openClipboard() {
		try {
			Clipboard opened = Clipboard.open(context);
			opened.listen(this::onClipboardChanged);
			clipboard = opened;
		} catch (ReflectiveOperationException | RuntimeException e) {
			Log.info("clipboard unavailable: " + e);
		}
	}

	/** On a binder thread. Hands the phone's new clipboard to the browser, unless the browser put it there. */
	private void onClipboardChanged() {
		String text = clipboard.text();
		synchronized (clipboardLock) {
			if (text == null || text.equals(clipboardText)) {
				return;
			}
			clipboardText = text;
		}
		Session session;
		synchronized (lock) {
			session = current;
		}
		if (session != null) {
			session.offerClipboard(text);
		}
	}

	/** Puts the browser's clipboard on the phone, and pastes it if asked. Called with input held. */
	private void setClipboard(String text, boolean paste) {
		synchronized (clipboardLock) {
			clipboardText = text;
		}
		if (clipboard != null && clipboard.setText(text) && paste) {
			input.paste();
		}
	}

	private void acceptClients() {
		while (!stopping) {
			try {
				LocalSocket client = socket.accept();
				new Thread(() -> handle(client), "client").start();
			} catch (IOException e) {
				Log.error("socket failed", e);
				return;
			}
		}
	}

	private void handle(LocalSocket client) {
		try {
			// adbd runs as the shell user. SELinux stopped an ordinary app reaching this far on the phone
			// we tried, but the session shouldn't rely on every build's policy doing the same.
			int uid = client.getPeerCredentials().getUid();
			if (uid != Hidden.SHELL_UID) {
				Log.info("refused a connection from uid " + uid);
				client.close();
				return;
			}
			Link link = new LocalLink(client);
			// adb has already vouched for the computer, so this says straight away that it's in.
			link.send(message(TYPE_AUTH_RESULT, new byte[] {AUTH_OK}), null);
			runSession(link);
		} catch (IOException e) {
			Log.info("client failed: " + e);
			try {
				client.close();
			} catch (IOException closeFailure) {
				Log.info("close failed: " + closeFailure);
			}
		}
	}

	private static byte[] message(int type, byte[] payload) {
		byte[] out = new byte[payload.length + 1];
		out[0] = (byte) type;
		System.arraycopy(payload, 0, out, 1, payload.length);
		return out;
	}

	private void runSession(Link link) throws IOException {
		link.setReadTimeout(0);
		link.setSendBufferSize(SEND_BUFFER_BYTES);
		Session session = new Session(link);
		synchronized (lock) {
			if (stopping) {
				link.close();
				return;
			}
			if (current != null) {
				Log.info("new client replaces the old one");
				current.closeAsReplaced();
			}
			try {
				session.start();
			} catch (IOException e) {
				session.close();
				throw e;
			}
			current = session;
			everConnected = true;
			keepAlive.acquire();
		}
		Log.info("client connected");
		try {
			session.readLoop();
		} catch (IOException e) {
			Log.info("client disconnected: " + e.getMessage());
		} finally {
			synchronized (lock) {
				session.close();
				if (current == session) {
					current = null;
					idleSince = System.currentTimeMillis();
				}
			}
		}
	}

	private void createDisplay() throws IOException {
		try {
			idleSurface = new IdleSurface();
			DisplayManager manager = DesktopDisplay.manager(context);
			phoneDisplay = manager.getDisplay(Display.DEFAULT_DISPLAY);
			display = DesktopDisplay.create(manager, DesktopDisplay.ID,
					options.width, options.height, options.dpi,
					options.keepRunningLocked ? DesktopDisplay.FLAGS_KEEP_RUNNING_LOCKED : 0,
					idleSurface.surface());
			displayId = display.getDisplay().getDisplayId();
			input = new Input(context, displayId);
			// The browser has a real keyboard, and the on-screen one would cover the desktop.
			Hidden.setImePolicy(displayId, Hidden.DISPLAY_IME_POLICY_HIDE);
			Log.info("display " + displayId + " created");
		} catch (ReflectiveOperationException e) {
			throw new IOException(e);
		}
	}

	/**
	 * Android puts every virtual display in the phone's display group, so when the phone sleeps the
	 * desktop is blanked and its apps stop. Real external displays get their own group, but a virtual
	 * one cannot. So during a session the phone never stays asleep: when it sleeps, which also locks
	 * it, wake it straight back up behind a forced-dark screen. The desktop never notices.
	 *
	 * The power button still works as people expect. Pressing it while the phone is unlocked locks it.
	 * Pressing it while locked and dark shows the lock screen, so the phone can still be used.
	 */
	private void keepPhoneAwake() {
		boolean lockedBeforeSleep = true;
		long darkNotBefore = 0;
		while (!stopping) {
			try {
				Thread.sleep(POWER_CHECK_MS);
			} catch (InterruptedException e) {
				return;
			}
			synchronized (lock) {
				// Checked again here: stop() holds the lock while it puts the phone to sleep.
				if (stopping) {
					return;
				}
				if (current == null && !panelDark) {
					continue;
				}
				long now = System.currentTimeMillis();
				if (Hidden.isInteractive()) {
					lockedBeforeSleep = Hidden.isKeyguardLocked();
				} else if (options.keepRunningLocked && unlockedThisSession) {
					panelDark = options.screenOff && !(panelDark && lockedBeforeSleep);
					Hidden.wakeUp();
					// Android applies its own screen change a moment later on another thread. Forcing
					// the screen off inside that gap lets the late change win, so wait it out.
					darkNotBefore = now + PANEL_SETTLE_MS;
					Log.info("phone slept, woke it with the screen " + (panelDark ? "dark" : "on"));
				}
				if (panelDark && now >= darkNotBefore && phoneDisplay.getState() == Display.STATE_ON
						&& !Hidden.requestDisplayPower(Display.DEFAULT_DISPLAY, false)) {
					// Without this it would try again, and log the failure, ten times a second.
					Log.info("this phone cannot turn its screen off during a session, so it stays on");
					panelDark = false;
				}
			}
		}
	}

	private void watch() {
		int tick = 0;
		while (!stopping) {
			try {
				Thread.sleep(TICK_MS);
			} catch (InterruptedException e) {
				return;
			}
			tick++;
			if (new File(dir, "stop").exists()) {
				stop("stop file");
				return;
			}
			boolean nowLocked = Hidden.isKeyguardLocked();
			boolean changed = nowLocked != locked;
			locked = nowLocked;
			if (!nowLocked) {
				unlockedThisSession = true;
			}
			if (tick == ELIGIBILITY_CHECK_TICK) {
				desktopEligible = Hidden.isEligibleForDesktopMode(displayId);
				Log.info("desktop eligible: " + desktopEligible);
				if (!desktopEligible) {
					Log.info("Android did not make this a desktop. Try turning on Enable desktop experience"
							+ " features in Developer options, then reboot.");
				}
				changed = true;
			}
			synchronized (lock) {
				if (current != null && System.currentTimeMillis() - current.lastMessageAt > CLIENT_SILENCE_LIMIT_MS) {
					Log.info("client went silent");
					current.close();
					current = null;
					idleSince = System.currentTimeMillis();
				}
				if (current != null && changed) {
					current.statusDirty = true;
				}
				if (current != null) {
					idleSince = System.currentTimeMillis();
					if (!locked) {
						applyScreenOff();
					}
				} else {
					long limit = (everConnected ? options.graceSeconds : options.idleSeconds) * 1000L;
					if (System.currentTimeMillis() - idleSince > limit) {
						stop("idle");
						return;
					}
				}
				// With the screen forced off, also keep the phone awake between connections, or a
				// replugged cable would find it locked and need someone to unlock it to carry on.
				boolean keepAwake = (current != null || panelDark) && (!locked || options.keepRunningLocked);
				if (keepAwake && tick % KEEP_AWAKE_TICKS == 0) {
					Hidden.userActivity(Display.DEFAULT_DISPLAY);
				}
			}
		}
	}

	/**
	 * Called with lock held. Waits for a client, so the phone stays readable while setting up, and
	 * applies only once, so the phone stays usable if someone unlocks it later in the session.
	 */
	private void applyScreenOff() {
		if (!options.screenOff || screenOffApplied) {
			return;
		}
		screenOffApplied = true;
		panelDark = true;
		Log.info("phone screen off");
	}

	/** Ends everything. The phone would otherwise stay awake, and possibly unlocked, with a dark screen. */
	private void stop(String reason) {
		Log.info("stopping: " + reason);
		stopping = true;
		synchronized (lock) {
			if (current != null) {
				current.close();
				current = null;
			}
			if (display != null) {
				try {
					display.release();
				} catch (RuntimeException e) {
					// Must not stop the phone being locked below. Exiting releases the display anyway.
					Log.error("could not release the display", e);
				}
				display = null;
			}
			// Leave the phone truly asleep and locked, unless someone is using it.
			if (panelDark || Hidden.isKeyguardLocked()) {
				lockPhone();
			}
		}
		if (!new File(dir, "stop").delete()) {
			Log.info("no stop file to remove");
		}
		Log.info("stopped");
		System.exit(0);
	}

	private static void lockPhone() {
		try {
			new ProcessBuilder("input", "keyevent", "SLEEP").start().waitFor();
		} catch (IOException | InterruptedException e) {
			Log.error("could not lock the phone", e);
		}
	}

	private static final class Frame {
		final int flags;
		final long captureUs;
		final long encodedUs;
		final byte[] data;

		Frame(int flags, long captureUs, long encodedUs, byte[] data) {
			this.flags = flags;
			this.captureUs = captureUs;
			this.encodedUs = encodedUs;
			this.data = data;
		}
	}

	private final class Session {
		private final Link link;
		private final ArrayBlockingQueue<Frame> queue = new ArrayBlockingQueue<>(QUEUED_FRAMES);
		private volatile Encoder encoder;
		private Thread sender;
		private volatile boolean closed;
		private volatile boolean waitingForKey;
		private volatile long droppedFrames;
		private AudioCapture audio;
		private volatile String audioState = "off";
		// Sent by the sender thread, which never blocks the binder thread the clipboard arrives on.
		private volatile String pendingClipboard;
		// Sent by the sender thread, so a stuck connection can never block the watchdog.
		volatile boolean statusDirty = true;
		volatile long lastMessageAt = System.currentTimeMillis();

		Session(Link link) {
			this.link = link;
		}

		/** Called with lock held. */
		void start() throws IOException {
			encoder = new Encoder(options, this::onFrame);
			display.setSurface(encoder.surface());
			sender = new Thread(this::sendLoop, "sender");
			sender.setDaemon(true);
			sender.start();
		}

		private void sendStatus() throws IOException {
			statusDirty = false;
			String json = "{\"displayId\":" + displayId
					+ ",\"width\":" + options.width
					+ ",\"height\":" + options.height
					+ ",\"locked\":" + locked
					+ ",\"usable\":" + isUsable()
					+ ",\"desktop\":" + desktopEligible
					+ ",\"encoder\":\"" + encoder.name() + "\""
					+ ",\"audio\":\"" + audioState + "\""
					+ ",\"clipboard\":" + (clipboard != null)
					+ ",\"dropped\":" + droppedFrames + "}";
			link.send(message(TYPE_STATUS, json.getBytes(StandardCharsets.UTF_8)), null);
		}

		private void onFrame(int flags, long captureUs, long encodedUs, byte[] data) {
			boolean config = (flags & Encoder.FLAG_CONFIG) != 0;
			boolean key = (flags & Encoder.FLAG_KEY) != 0;
			if (waitingForKey && !config && !key) {
				return;
			}
			if (key) {
				waitingForKey = false;
			}
			if (!queue.offer(new Frame(flags, captureUs, encodedUs, data))) {
				// The link cannot keep up. Old video is worthless, so skip to a fresh key frame.
				droppedFrames += queue.size() + 1;
				queue.clear();
				waitingForKey = true;
				encoder.requestKeyFrame();
			}
		}

		private void sendLoop() {
			ByteBuffer head = ByteBuffer.allocate(26);
			try {
				while (true) {
					Frame frame = queue.poll(SENDER_POLL_MS, TimeUnit.MILLISECONDS);
					if (statusDirty) {
						sendStatus();
					}
					String text = pendingClipboard;
					if (text != null) {
						pendingClipboard = null;
						link.send(new byte[] {TYPE_CLIPBOARD}, text.getBytes(StandardCharsets.UTF_8));
					}
					if (frame == null) {
						continue;
					}
					head.clear();
					head.put((byte) TYPE_VIDEO);
					head.put((byte) frame.flags);
					head.putLong(frame.captureUs);
					head.putLong(frame.encodedUs);
					head.putLong(System.nanoTime() / 1000);
					link.send(head.array(), frame.data);
				}
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			} catch (IOException e) {
				link.close();
			}
		}

		void readLoop() throws IOException {
			while (true) {
				ByteBuffer m = ByteBuffer.wrap(link.read());
				lastMessageAt = System.currentTimeMillis();
				int type = m.get() & 0xFF;
				switch (type) {
					case TYPE_PING:
						ByteBuffer pong = ByteBuffer.allocate(17);
						pong.put((byte) TYPE_PONG);
						pong.putDouble(m.getDouble());
						pong.putLong(System.nanoTime() / 1000);
						link.send(pong.array(), null);
						break;
					case TYPE_KEY_FRAME:
						encoder.requestKeyFrame();
						break;
					case TYPE_RESIZE:
						resize(m.getInt(), m.getInt());
						break;
					case TYPE_AUDIO_CONTROL:
						setAudio(m.get() != 0);
						break;
					case TYPE_STOP:
						new Thread(() -> stop("client asked"), "stop").start();
						return;
					default:
						// Nothing reaches the desktop while the phone is locked, unless opted in.
						if (isUsable() && !closed) {
							handleInput(type, m);
						}
						break;
				}
			}
		}

		void offerClipboard(String text) {
			pendingClipboard = text;
		}

		/** Moves the phone's sound to the browser, or back to the phone. */
		private void setAudio(boolean on) {
			synchronized (lock) {
				if (closed || on == (audio != null)) {
					return;
				}
				if (!on) {
					audio.stop();
					audio = null;
					audioState = "off";
					Log.info("audio back on the phone");
				} else {
					try {
						audio = new AudioCapture(context, new AudioCapture.Sink() {
							@Override
							public void onAudio(long captureUs, byte[] pcm) {
								sendAudio(captureUs, pcm);
							}

							@Override
							public void onAudioFailed(String reason) {
								Log.info(reason);
								audioState = "failed";
								statusDirty = true;
							}
						});
						audioState = "on";
						Log.info("audio to the browser");
					} catch (IOException e) {
						Log.info(e.getMessage());
						audioState = "failed";
					}
				}
				statusDirty = true;
			}
		}

		private void sendAudio(long captureUs, byte[] pcm) {
			ByteBuffer head = ByteBuffer.allocate(9);
			head.put((byte) TYPE_AUDIO);
			head.putLong(captureUs);
			try {
				link.send(head.array(), pcm);
			} catch (IOException e) {
				link.close();
			}
		}

		/** Gives the desktop the shape of the browser's window, so the picture fills it with no bars. */
		private void resize(int width, int height) throws IOException {
			int newWidth = desktopSide(width);
			int newHeight = desktopSide(height);
			synchronized (lock) {
				if (options.fixedSize || closed || (newWidth == options.width && newHeight == options.height)) {
					return;
				}
				Log.info("desktop resized to " + newWidth + "x" + newHeight);
				display.setSurface(idleSurface.surface());
				encoder.stop();
				queue.clear();
				options.width = newWidth;
				options.height = newHeight;
				display.resize(newWidth, newHeight, options.dpi);
				encoder = new Encoder(options, this::onFrame);
				display.setSurface(encoder.surface());
				statusDirty = true;
			}
		}

		/** Encoders need even numbers. */
		private int desktopSide(int side) {
			return Math.max(MIN_DESKTOP_SIDE, Math.min(MAX_DESKTOP_SIDE, side)) & ~1;
		}

		private void handleInput(int type, ByteBuffer m) {
			synchronized (input) {
				switch (type) {
					case TYPE_MOUSE:
						int action = m.get();
						int button = m.get();
						input.mouse(action, button, clampX(m.getInt()), clampY(m.getInt()));
						break;
					case TYPE_SCROLL:
						input.scroll(clampX(m.getInt()), clampY(m.getInt()), m.getFloat(), m.getFloat());
						break;
					case TYPE_KEY:
						input.key(m.get(), m.getInt(), m.getInt());
						break;
					case TYPE_SET_CLIPBOARD:
						boolean paste = (m.get() & CLIPBOARD_PASTE) != 0;
						byte[] text = new byte[m.remaining()];
						m.get(text);
						setClipboard(new String(text, StandardCharsets.UTF_8), paste);
						break;
					default:
						Log.info("unknown message type " + type);
						break;
				}
			}
		}

		private int clampX(int x) {
			return Math.max(0, Math.min(options.width - 1, x));
		}

		private int clampY(int y) {
			return Math.max(0, Math.min(options.height - 1, y));
		}

		/** Called with lock held. */
		void close() {
			if (closed) {
				return;
			}
			closed = true;
			link.close();
			release();
		}

		/** Called with lock held. Says why first, so the old client stays away instead of taking the session back. */
		void closeAsReplaced() {
			if (closed) {
				return;
			}
			closed = true;
			// On its own thread, because a stuck connection must not hold up the new client.
			Thread farewell = new Thread(() -> {
				try {
					link.send(message(TYPE_REPLACED, new byte[0]), null);
				} catch (IOException e) {
					Log.info("could not tell the old client: " + e.getMessage());
				}
			}, "farewell");
			farewell.setDaemon(true);
			farewell.start();
			link.closeAfter(FAREWELL_MS);
			release();
		}

		private void release() {
			if (sender != null) {
				sender.interrupt();
			}
			if (input != null) {
				synchronized (input) {
					input.releaseAll();
				}
			}
			if (display != null) {
				display.setSurface(idleSurface.surface());
			}
			if (encoder != null) {
				encoder.stop();
			}
			if (audio != null) {
				audio.stop();
				audio = null;
			}
		}
	}
}
