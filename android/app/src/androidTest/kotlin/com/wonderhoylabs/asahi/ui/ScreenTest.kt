package com.wonderhoylabs.asahi.ui

import android.graphics.Bitmap
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import com.wonderhoylabs.asahi.tunnel.TunnelStats
import com.wonderhoylabs.asahi.vpn.AsahiStatus
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.io.File

/** Draws every state of the screen, checks what it says and what its buttons do, and saves a picture. */
class ScreenTest {
	@get:Rule
	val rule = createComposeRule()

	private val calls = mutableListOf<String>()
	private val actions = ScreenActions(
		onActivate = { calls += "activate" },
		onDeactivate = { calls += "deactivate" },
		onDismissError = { calls += "dismiss" },
	)

	private fun show(status: AsahiStatus, error: String? = null, dark: Boolean = false) {
		// The spinner never stops, so the test's clock only moves when it's told to.
		rule.mainClock.autoAdvance = false
		rule.setContent {
			AsahiTheme(darkTheme = dark) {
				Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
					AsahiScreen(ScreenState(status, error), actions)
				}
			}
		}
		rule.mainClock.advanceTimeBy(FRAME_MILLIS)
	}

	private fun click(text: String) {
		rule.onNodeWithText(text).performScrollTo().performClick()
		rule.mainClock.advanceTimeBy(FRAME_MILLIS)
	}

	private fun picture(name: String) {
		val bitmap = rule.onRoot().captureToImage().asAndroidBitmap()
		val context = InstrumentationRegistry.getInstrumentation().targetContext
		val directory = File(context.getExternalFilesDir(null), "screens").apply { mkdirs() }
		File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
	}

	private fun connected() = AsahiStatus.Connected(
		"wisp.example.com",
		TunnelStats().apply {
			bytesDown = 52_428_800
			bytesUp = 1_572_864
			connections = 14
		},
	)

	@Test
	fun off() {
		show(AsahiStatus.Off)
		rule.onNodeWithText("Off").assertIsDisplayed()
		rule.onNodeWithText("How to use it").assertIsDisplayed()
		picture("off")
		click("Turn on")
		assertEquals(listOf("activate"), calls)
	}

	@Test
	fun waiting() {
		show(AsahiStatus.Waiting)
		rule.onNodeWithText("Waiting for your computer").assertIsDisplayed()
		picture("waiting")
		click("Turn off")
		assertEquals(listOf("deactivate"), calls)
	}

	@Test
	fun connectedShowsTheServerAndTraffic() {
		show(connected())
		rule.onNodeWithText("Online through your computer").assertIsDisplayed()
		rule.onNodeWithText("Through wisp.example.com").assertIsDisplayed()
		rule.onNodeWithText("50.0 MB").assertIsDisplayed()
		rule.onNodeWithText("1.5 MB").assertIsDisplayed()
		rule.onNodeWithText("14").assertIsDisplayed()
		picture("connected")
		click("Turn off")
		assertEquals(listOf("deactivate"), calls)
	}

	@Test
	fun errorCanBeDismissed() {
		show(AsahiStatus.Off, error = "Android needs your OK before Asahi can act as a VPN.")
		rule.onNodeWithText("Android needs your OK before Asahi can act as a VPN.").assertIsDisplayed()
		picture("error")
		click("Dismiss")
		assertEquals(listOf("dismiss"), calls)
	}

	@Test
	fun darkOff() {
		show(AsahiStatus.Off, dark = true)
		picture("off-dark")
	}

	@Test
	fun darkConnected() {
		show(connected(), dark = true)
		picture("connected-dark")
	}

	@Test
	fun darkError() {
		show(
			AsahiStatus.Waiting,
			error = "Another VPN has taken over. Click Launch on the web page again, or turn Asahi on here.",
			dark = true,
		)
		picture("error-dark")
	}

	private companion object {
		const val FRAME_MILLIS = 400L
	}
}
