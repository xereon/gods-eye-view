package com.example.godseyeview

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.example.godseyeview.theme.GodsEyeViewTheme

class MainActivity : ComponentActivity() {
    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view != null && view.canGoBack()) view.goBack() else finish()
            }
        })
        setContent {
            GodsEyeViewTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    GodsEyeWebView(startUrl(), onCreated = { webView = it })
                }
            }
        }
    }

    override fun onDestroy() {
        webView = null
        super.onDestroy()
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

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun GodsEyeWebView(url: String, onCreated: (WebView) -> Unit) {
    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.mediaPlaybackRequiresUserGesture = false
                CookieManager.getInstance().setAcceptCookie(true)

                webViewClient = WebViewClient()
                webChromeClient = object : WebChromeClient() {
                    override fun onPermissionRequest(request: PermissionRequest) {
                        request.grant(request.resources)
                    }
                }

                WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
                onCreated(this)
                loadUrl(url)
            }
        },
    )
}
