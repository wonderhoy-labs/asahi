package com.wonderhoylabs.asahi.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// The same colours as the web page, made with Material's colour utilities from the logo: her lavender
// hair, the blush of the bow and the blue glass of the bottle beside her.
private val LightColors = lightColorScheme(
    primary = Color(0xFF6E4F99),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEDDCFF),
    onPrimaryContainer = Color(0xFF553780),
    inversePrimary = Color(0xFFD7BAFF),
    secondary = Color(0xFF864E5D),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFFFD9E1),
    onSecondaryContainer = Color(0xFF6A3746),
    tertiary = Color(0xFF31628D),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFCFE5FF),
    onTertiaryContainer = Color(0xFF124A73),
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF93000A),
    background = Color(0xFFFEF7FE),
    onBackground = Color(0xFF1D1B1F),
    surface = Color(0xFFFEF7FE),
    onSurface = Color(0xFF1D1B1F),
    surfaceVariant = Color(0xFFE9DFEE),
    onSurfaceVariant = Color(0xFF4A4450),
    surfaceDim = Color(0xFFDED8DE),
    surfaceBright = Color(0xFFFEF7FE),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF8F2F8),
    surfaceContainer = Color(0xFFF2ECF2),
    surfaceContainerHigh = Color(0xFFEDE6ED),
    surfaceContainerHighest = Color(0xFFE7E0E7),
    inverseSurface = Color(0xFF322F34),
    inverseOnSurface = Color(0xFFF5EFF5),
    outline = Color(0xFF7B7481),
    outlineVariant = Color(0xFFCCC3D2),
    scrim = Color(0xFF000000),
    surfaceTint = Color(0xFF6E4F99),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFD7BAFF),
    onPrimary = Color(0xFF3E1F67),
    primaryContainer = Color(0xFF553780),
    onPrimaryContainer = Color(0xFFEDDCFF),
    inversePrimary = Color(0xFF6E4F99),
    secondary = Color(0xFFFAB3C5),
    onSecondary = Color(0xFF502130),
    secondaryContainer = Color(0xFF6A3746),
    onSecondaryContainer = Color(0xFFFFD9E1),
    tertiary = Color(0xFF9DCBFB),
    onTertiary = Color(0xFF003355),
    tertiaryContainer = Color(0xFF124A73),
    onTertiaryContainer = Color(0xFFCFE5FF),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF151217),
    onBackground = Color(0xFFE7E0E7),
    surface = Color(0xFF151217),
    onSurface = Color(0xFFE7E0E7),
    surfaceVariant = Color(0xFF4A4450),
    onSurfaceVariant = Color(0xFFCCC3D2),
    surfaceDim = Color(0xFF151217),
    surfaceBright = Color(0xFF3B383D),
    surfaceContainerLowest = Color(0xFF0F0D12),
    surfaceContainerLow = Color(0xFF1D1B1F),
    surfaceContainer = Color(0xFF211F23),
    surfaceContainerHigh = Color(0xFF2C292E),
    surfaceContainerHighest = Color(0xFF373439),
    inverseSurface = Color(0xFFE7E0E7),
    inverseOnSurface = Color(0xFF322F34),
    outline = Color(0xFF958E9B),
    outlineVariant = Color(0xFF4A4450),
    scrim = Color(0xFF000000),
    surfaceTint = Color(0xFFD7BAFF),
)

@Composable
fun AsahiTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}
