package com.wonderhoylabs.asahi.server;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;

import androidx.annotation.RequiresApi;

/**
 * Holds the phone's CPU awake once a client has connected. With the screen off, the phone would
 * otherwise suspend, which stalls the video.
 *
 * Android releases both when the process exits, so they cannot outlive the server.
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
final class KeepAlive {

    private static final String TAG = "asahi:desktop";

    private final Context context;
    private boolean held;

    KeepAlive(Context context) {
        this.context = context;
    }

    void acquire() {
        if (held) {
            return;
        }
        held = true;
        try {
            PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG);
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
            Log.info("wake lock held");
        } catch (RuntimeException e) {
            Log.error("no wake lock", e);
        }
    }
}
