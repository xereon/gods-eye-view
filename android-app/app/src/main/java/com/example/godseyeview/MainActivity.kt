package com.example.godseyeview

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.godseyeview.theme.GodsEyeViewTheme

class MainActivity : ComponentActivity() {
    private var webView: WebView? = null

    /** True while the last page load failed, so the retry screen shows instead. */
    private var loadFailed by mutableStateOf(false)

    /** Answers the page once the user responds to the Android permission dialog. */
    private var onPermissionResult: ((Map<String, Boolean>) -> Unit)? = null
    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            onPermissionResult?.invoke(result)
            onPermissionResult = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light status and navigation icons over the black bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView ?: return finish()
                // The page uses Back first: to leave zoom mode, or to return
                // from the on-screen controls to the globe.
                view.evaluateJavascript("window.gevHandleBack?.() === true") { used ->
                    if (used == "true") return@evaluateJavascript
                    if (view.canGoBack()) view.goBack() else finish()
                }
            }
        })
        setContent {
            GodsEyeViewTheme {
                // The page draws its own dark chrome, so keep it clear of the
                // status bar, navigation bar and camera cutout.
                Surface(modifier = Modifier.fillMaxSize(), color = Color.Black) {
                    Box(Modifier.safeDrawingPadding()) {
                        GodsEyeWebView(
                            url = startUrl(),
                            onCreated = { webView = it },
                            onMainFrameError = { loadFailed = true },
                            requestPermissions = ::requestPermissions,
                        )
                        if (loadFailed) {
                            LoadFailedScreen(onRetry = {
                                loadFailed = false
                                webView?.reload()
                            })
                        }
                    }
                }
            }
        }
    }

    // Pausing the WebView stops the page's timers and live-data polling while
    // the app is in the background, which saves battery and data.
    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        webView = null
        super.onDestroy()
    }

    /**
     * Asks Android for [permissions] that are not granted yet, then reports
     * which of them the app holds.
     */
    private fun requestPermissions(permissions: List<String>, onResult: (Set<String>) -> Unit) {
        val missing = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty() || onPermissionResult != null) {
            // Nothing to ask, or a dialog is already open: answer with what we hold.
            onResult(permissions.filter { it !in missing }.toSet())
            return
        }
        onPermissionResult = { result ->
            onResult(permissions.filter { it !in missing || result[it] == true }.toSet())
        }
        permissionLauncher.launch(missing.toTypedArray())
    }
}

/**
 * The hosted server's address. With an access key, the first load passes it as
 * `?key=`; the server answers with a cookie and drops the key from the URL.
 */
private fun startUrl(): String {
    val base = Uri.parse(BuildConfig.SERVER_URL)
    if (BuildConfig.ACCESS_KEY.isEmpty()) return base.toString()
    return base.buildUpon().appendQueryParameter("key", BuildConfig.ACCESS_KEY).build().toString()
}

/** Whether [uri] is on the God's Eye View server rather than an outside site. */
private fun isAppOrigin(uri: Uri): Boolean {
    val server = Uri.parse(BuildConfig.SERVER_URL)
    return uri.scheme == server.scheme && uri.host == server.host && uri.port == server.port
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun GodsEyeWebView(
    url: String,
    onCreated: (WebView) -> Unit,
    onMainFrameError: () -> Unit,
    requestPermissions: (List<String>, (Set<String>) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                // Without explicit MATCH_PARENT the WebView is WRAP_CONTENT,
                // which makes CSS viewport units (100vh, 100dvh) resolve to 0
                // and leaves the globe's canvas 0 px tall.
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                )
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                CookieManager.getInstance().setAcceptCookie(true)

                webViewClient = object : WebViewClient() {
                    // Links to other sites (data sources, credits) open in the
                    // browser so the globe stays loaded behind them.
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val target = request.url
                        if (!request.isForMainFrame || isAppOrigin(target)) return false
                        if (target.scheme != "http" && target.scheme != "https") return true
                        try {
                            view.context.startActivity(Intent(Intent.ACTION_VIEW, target))
                        } catch (_: ActivityNotFoundException) {
                            return false
                        }
                        return true
                    }

                    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                        if (request.isForMainFrame) onMainFrameError()
                    }
                }
                webChromeClient = object : WebChromeClient() {
                    // The page asks for the microphone for voice control. Only
                    // our own server is trusted, and the site permission is
                    // granted only once Android has granted RECORD_AUDIO.
                    override fun onPermissionRequest(request: PermissionRequest) {
                        val wantsAudio = PermissionRequest.RESOURCE_AUDIO_CAPTURE in request.resources
                        if (!isAppOrigin(request.origin) || !wantsAudio) {
                            request.deny()
                            return
                        }
                        requestPermissions(listOf(Manifest.permission.RECORD_AUDIO)) { granted ->
                            if (Manifest.permission.RECORD_AUDIO in granted) {
                                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                            } else {
                                request.deny()
                            }
                        }
                    }

                    // The radio receiver uses the device location to find nearby stations.
                    override fun onGeolocationPermissionsShowPrompt(
                        origin: String,
                        callback: GeolocationPermissions.Callback,
                    ) {
                        if (!isAppOrigin(Uri.parse(origin))) {
                            callback.invoke(origin, false, false)
                            return
                        }
                        val location = listOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                        )
                        requestPermissions(location) { granted ->
                            callback.invoke(origin, granted.isNotEmpty(), false)
                        }
                    }

                    // Page console output shows in Logcat under the GEV tag.
                    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                        if (!BuildConfig.DEBUG) return false
                        Log.i("GEV", "${message.messageLevel()} ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                        return true
                    }
                }

                WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
                onCreated(this)
                loadUrl(url)
            }
        },
    )
}

/** Shown over the WebView when the server can't be reached. */
@Composable
private fun LoadFailedScreen(onRetry: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = Color.Black) {
        Column(
            modifier = Modifier.fillMaxSize().padding(32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(R.string.load_failed_title),
                style = MaterialTheme.typography.titleLarge,
                color = Color.White,
                textAlign = TextAlign.Center,
            )
            Text(
                text = stringResource(R.string.load_failed_body),
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFFB0B0B0),
                textAlign = TextAlign.Center,
            )
            Button(onClick = onRetry) { Text(stringResource(R.string.retry)) }
        }
    }
}
