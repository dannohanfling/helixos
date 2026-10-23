package com.evolveomega.helixos;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;

/**
 * Capacitor's web view client, with one change to failed page loads (H-1806, plan H-1813).
 *
 * Capacitor shows the bundled offline screen on any failed load of the page, and also whenever the server answers with an
 * error page (a moment during a deploy, say), so the app could say "You're offline" with full signal. Here:
 * - a page from the server, even an error page, is shown as it is: HelixOS was reachable;
 * - a load that another navigation replaced (net::ERR_ABORTED) is ignored;
 * - any other failure is tried once more after 1.5 s (the logo screen stays up meanwhile), and only a second failure in a row
 *   shows the offline screen.
 */
public class HelixWebViewClient extends BridgeWebViewClient {

    static final long RETRY_DELAY_MS = 1500;

    private final Bridge bridge;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean retried = false;
    // Android finishes a failed load too (on its own error page), so a finish only counts when this load didn't fail.
    private boolean failedThisLoad = false;

    public HelixWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        failedThisLoad = false;
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        // A page came through: the next failure gets its own retry. The offline screen itself doesn't count.
        if (!failedThisLoad && url != null && !url.equals(bridge.getErrorUrl())) retried = false;
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (!request.isForMainFrame()) {
            super.onReceivedHttpError(view, request, errorResponse);
            return;
        }
        // Not passed to Capacitor, whose handler would swap the page for offline.html.
        Logger.debug("HelixOS: the page answered " + errorResponse.getStatusCode() + "; shown as it is, not offline");
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) {
            super.onReceivedError(view, request, error);
            return;
        }
        CharSequence description = error.getDescription();
        if (description != null && description.toString().contains("ERR_ABORTED")) {
            Logger.debug("HelixOS: a load was interrupted, not offline");
            return;
        }
        failedThisLoad = true;
        final String url = request.getUrl().toString();
        if (retried || !url.startsWith("https://") || url.equals(bridge.getErrorUrl())) {
            super.onReceivedError(view, request, error);
            return;
        }
        retried = true;
        Logger.debug("HelixOS: load failed (" + error.getErrorCode() + "), trying once more");
        main.postDelayed(() -> view.loadUrl(url), RETRY_DELAY_MS);
    }
}
