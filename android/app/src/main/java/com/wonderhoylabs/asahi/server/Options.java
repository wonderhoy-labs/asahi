package com.wonderhoylabs.asahi.server;

import java.util.ArrayList;
import java.util.List;

final class Options {
	String dir = "/data/local/tmp/asahi";
	volatile int width = 1920;
	volatile int height = 1080;
	/** Someone chose the size, so the browser can't reshape the desktop to fit its window. */
	boolean fixedSize;
	volatile int dpi = 160;
	int bitrate = 20_000_000;
	/** A specific encoder from --list-encoders. Otherwise Android picks one. */
	String encoderName;
	/** Extra integer encoder settings, as key=value. */
	final List<String> encoderSettings = new ArrayList<>();
	boolean listEncoders;
	/** Turns the phone's own screen off during a session. The phone stays awake underneath. */
	boolean screenOff = true;
	/**
	 * Keeps the desktop usable after the phone locks, so a session needs only one unlock. Whoever
	 * holds the USB connection can use apps without the phone's PIN until the session ends.
	 */
	boolean keepRunningLocked = true;
	/** How long the desktop survives after the browser goes, so a replugged cable doesn't end it. */
	int graceSeconds = 120;
	/** How long to wait for the browser to connect before giving up. */
	int idleSeconds = 120;

	static Options parse(String[] args) {
		Options options = new Options();
		for (int i = 0; i < args.length; i++) {
			switch (args[i]) {
				case "--dir":
					options.dir = args[++i];
					break;
				case "--size":
					String[] size = args[++i].split("x");
					options.width = Integer.parseInt(size[0]);
					options.height = Integer.parseInt(size[1]);
					options.fixedSize = true;
					break;
				case "--dpi":
					options.dpi = Integer.parseInt(args[++i]);
					break;
				case "--bitrate":
					options.bitrate = Integer.parseInt(args[++i]);
					break;
				case "--encoder":
					options.encoderName = args[++i];
					break;
				case "--encoder-setting":
					options.encoderSettings.add(args[++i]);
					break;
				case "--list-encoders":
					options.listEncoders = true;
					break;
				case "--screen-on":
					options.screenOff = false;
					break;
				case "--pause-when-locked":
					options.keepRunningLocked = false;
					break;
				case "--grace":
					options.graceSeconds = Integer.parseInt(args[++i]);
					break;
				case "--idle":
					options.idleSeconds = Integer.parseInt(args[++i]);
					break;
				default:
					throw new IllegalArgumentException("Unknown option: " + args[i]);
			}
		}
		return options;
	}
}
