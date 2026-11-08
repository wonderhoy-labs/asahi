package com.wonderhoylabs.asahi.server;

import android.app.Application;
import android.app.Instrumentation;
import android.content.AttributionSource;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SystemClock;
import android.view.Display;

import androidx.annotation.RequiresApi;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Non-SDK Android calls, all made through reflection.
 *
 * Process setup is adapted from scrcpy's Workarounds and FakeContext (Apache-2.0).
 */
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
final class Hidden {

	private static final String WINDOW_MANAGER_STUB = "android.view.IWindowManager$Stub";
	private static final String POWER_MANAGER_STUB = "android.os.IPowerManager$Stub";
	private static final int WAKE_REASON_APPLICATION = 2;
	private static final String SHELL_PACKAGE = "com.android.shell";
	static final int SHELL_UID = 2000;
	private static final int USER_ACTIVITY_EVENT_OTHER = 0;
	/** Never shows it. Remote clients have a real keyboard, and it would cover the desktop. */
	static final int DISPLAY_IME_POLICY_HIDE = 2;

	private Hidden() {
	}

	/** Turns a display's panel on or off without changing whether the system considers it awake. */
	static boolean requestDisplayPower(int displayId, boolean on) {
		try {
			Object manager = service(Context.DISPLAY_SERVICE, "android.hardware.display.IDisplayManager$Stub");
			Method method = manager.getClass().getMethod("requestDisplayPower", int.class, int.class);
			int state = on ? Display.STATE_ON : Display.STATE_OFF;
			return (boolean) method.invoke(manager, displayId, state);
		} catch (ReflectiveOperationException e) {
			Log.error("requestDisplayPower failed", e);
			return false;
		}
	}

	/** Reports locked if the check fails, because input must never reach a phone that might be locked. */
	static boolean isKeyguardLocked() {
		try {
			Object windowManager = service(Context.WINDOW_SERVICE, WINDOW_MANAGER_STUB);
			return (boolean) windowManager.getClass().getMethod("isKeyguardLocked").invoke(windowManager);
		} catch (ReflectiveOperationException e) {
			Log.error("isKeyguardLocked failed", e);
			return true;
		}
	}

	/** Whether Android treats this display as able to host a desktop, windowing and all. */
	static boolean isEligibleForDesktopMode(int displayId) {
		try {
			Object windowManager = service(Context.WINDOW_SERVICE, WINDOW_MANAGER_STUB);
			return (boolean) windowManager.getClass().getMethod("isEligibleForDesktopMode", int.class)
					.invoke(windowManager, displayId);
		} catch (ReflectiveOperationException e) {
			Log.error("isEligibleForDesktopMode failed", e);
			return false;
		}
	}

	/** Reports awake if the check fails, so a failure cannot cause a wake loop. */
	static boolean isInteractive() {
		try {
			Object power = service(Context.POWER_SERVICE, POWER_MANAGER_STUB);
			return (boolean) power.getClass().getMethod("isDisplayInteractive", int.class)
					.invoke(power, Display.DEFAULT_DISPLAY);
		} catch (ReflectiveOperationException e) {
			Log.error("isDisplayInteractive failed", e);
			return true;
		}
	}

	static void wakeUp() {
		try {
			Object power = service(Context.POWER_SERVICE, POWER_MANAGER_STUB);
			power.getClass().getMethod("wakeUp", long.class, int.class, String.class, String.class)
					.invoke(power, SystemClock.uptimeMillis(), WAKE_REASON_APPLICATION, "asahi", SHELL_PACKAGE);
		} catch (ReflectiveOperationException e) {
			Log.error("wakeUp failed", e);
		}
	}

	static void setImePolicy(int displayId, int policy) {
		try {
			Object windowManager = service(Context.WINDOW_SERVICE, WINDOW_MANAGER_STUB);
			windowManager.getClass().getMethod("setDisplayImePolicy", int.class, int.class)
					.invoke(windowManager, displayId, policy);
		} catch (ReflectiveOperationException e) {
			Log.error("could not set the on-screen keyboard policy", e);
		}
	}

	/** Stops the phone timing out while a client is connected. */
	static void userActivity(int displayId) {
		try {
			Object power = service(Context.POWER_SERVICE, POWER_MANAGER_STUB);
			power.getClass().getMethod("userActivity", int.class, long.class, int.class, int.class)
					.invoke(power, displayId, SystemClock.uptimeMillis(), USER_ACTIVITY_EVENT_OTHER, 0);
		} catch (ReflectiveOperationException e) {
			Log.error("userActivity failed", e);
		}
	}

	static Object service(String name, String stubClass) throws ReflectiveOperationException {
		Object binder = Class.forName("android.os.ServiceManager")
				.getMethod("getService", String.class).invoke(null, name);
		return Class.forName(stubClass).getMethod("asInterface", IBinder.class).invoke(null, binder);
	}

	static Context createShellContext() throws ReflectiveOperationException {
		Class<?> threadClass = Class.forName("android.app.ActivityThread");
		Constructor<?> threadCtor = threadClass.getDeclaredConstructor();
		threadCtor.setAccessible(true);
		Object thread = threadCtor.newInstance();
		setField(threadClass, null, "sCurrentActivityThread", thread);
		setField(threadClass, thread, "mSystemThread", true);

		Class<?> controllerClass = Class.forName("android.app.ConfigurationController");
		Constructor<?> controllerCtor = controllerClass.getDeclaredConstructor(
				Class.forName("android.app.ActivityThreadInternal"));
		controllerCtor.setAccessible(true);
		setField(threadClass, thread, "mConfigurationController", controllerCtor.newInstance(thread));

		Class<?> bindDataClass = Class.forName("android.app.ActivityThread$AppBindData");
		Constructor<?> bindDataCtor = bindDataClass.getDeclaredConstructor();
		bindDataCtor.setAccessible(true);
		Object bindData = bindDataCtor.newInstance();
		ApplicationInfo appInfo = new ApplicationInfo();
		appInfo.packageName = SHELL_PACKAGE;
		setField(bindDataClass, bindData, "appInfo", appInfo);
		setField(threadClass, thread, "mBoundApplication", bindData);

		Method getSystemContext = threadClass.getDeclaredMethod("getSystemContext");
		getSystemContext.setAccessible(true);
		Context shell = new ShellContext((Context) getSystemContext.invoke(thread));
		Application application = Instrumentation.newApplication(Application.class, shell);
		setField(threadClass, thread, "mInitialApplication", application);
		return shell;
	}

	private static void setField(Class<?> owner, Object target, String name, Object value)
			throws ReflectiveOperationException {
		Field field = owner.getDeclaredField(name);
		field.setAccessible(true);
		field.set(target, value);
	}

	private static final class ShellContext extends ContextWrapper {
		ShellContext(Context base) {
			super(base);
		}

		@Override
		public String getPackageName() {
			return SHELL_PACKAGE;
		}

		@Override
		public String getOpPackageName() {
			return SHELL_PACKAGE;
		}

		@Override
		public AttributionSource getAttributionSource() {
			return new AttributionSource.Builder(SHELL_UID).setPackageName(SHELL_PACKAGE).build();
		}

		@Override
		public int getDeviceId() {
			return 0;
		}

		@Override
		public Context getApplicationContext() {
			return this;
		}
	}
}
