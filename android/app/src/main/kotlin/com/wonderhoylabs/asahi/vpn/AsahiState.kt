package com.wonderhoylabs.asahi.vpn

import com.wonderhoylabs.asahi.tunnel.TunnelStats
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

sealed interface AsahiStatus {
    /** The service isn't running. */
    data object Off : AsahiStatus

    /** The service is listening, and nothing's using the VPN yet, so the phone's network is untouched. */
    data object Waiting : AsahiStatus

    /** A web page is attached and the VPN is up. */
    data class Connected(val server: String, val stats: TunnelStats) : AsahiStatus
}

/** What the service is doing, for the screen to show. */
object AsahiState {
    private val mutableStatus = MutableStateFlow<AsahiStatus>(AsahiStatus.Off)
    private val mutableError = MutableStateFlow<String?>(null)

    val status: StateFlow<AsahiStatus> = mutableStatus.asStateFlow()
    val error: StateFlow<String?> = mutableError.asStateFlow()

    fun setStatus(status: AsahiStatus) {
        mutableStatus.value = status
    }

    fun setError(message: String?) {
        mutableError.value = message
    }
}
