import UIKit
import WebKit
import Capacitor

/// The app's main screen: Capacitor's own, with one change to failed page loads (H-1806, plan H-1813).
///
/// Capacitor shows the bundled offline screen on any failed load, including one that was only cancelled because a redirect or a
/// second navigation took over (opening /today signed out, or from a notification). That showed "You're offline" with full
/// signal. Here a cancelled or interrupted load is ignored, any other failure is tried once more after 1.5 s (the logo screen
/// stays up meanwhile), and only a second failure in a row shows the offline screen.
class HelixBridgeViewController: CAPBridgeViewController {
    private var loadGuard: HelixLoadGuard?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // The web view exists and Capacitor's handler is its navigation delegate; the first page hasn't started loading yet.
        guard let webView = webView, let inner = webView.navigationDelegate as? WebViewDelegationHandler else { return }
        let loadGuard = HelixLoadGuard(inner: inner, errorURL: bridge?.config.errorPathURL)
        self.loadGuard = loadGuard
        webView.navigationDelegate = loadGuard
    }
}

/// Sits in front of Capacitor's navigation handler: it takes the two failure callbacks and the finish, and passes every other
/// call straight through.
final class HelixLoadGuard: NSObject, WKNavigationDelegate {
    static let retryDelay: TimeInterval = 1.5

    private weak var inner: WebViewDelegationHandler?
    private let errorURL: URL?
    private var retried = false

    init(inner: WebViewDelegationHandler, errorURL: URL?) {
        self.inner = inner
        self.errorURL = errorURL
        super.init()
    }

    /// A load another navigation replaced, or one the app itself turned away (a link handed to Safari): not a failure.
    static func isInterruption(_ error: NSError) -> Bool {
        (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled) ||
            (error.domain == "WebKitErrorDomain" && error.code == 102) // frame load interrupted by a policy change
    }

    override func responds(to aSelector: Selector!) -> Bool {
        super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false)
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if inner?.responds(to: aSelector) == true { return inner }
        return super.forwardingTarget(for: aSelector)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // A page came through: the next failure gets its own retry. The offline screen itself doesn't count.
        if webView.url != errorURL { retried = false }
        inner?.webView(webView, didFinish: navigation)
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        handle(webView, error as NSError) { [weak self] in self?.inner?.webView(webView, didFail: navigation, withError: error) }
    }

    // swiftlint:disable:next implicitly_unwrapped_optional
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handle(webView, error as NSError) { [weak self] in
            self?.inner?.webView(webView, didFailProvisionalNavigation: navigation, withError: error)
        }
    }

    private func handle(_ webView: WKWebView, _ error: NSError, showOffline: @escaping () -> Void) {
        if HelixLoadGuard.isInterruption(error) {
            CAPLog.print("⚡️  HelixOS: a load was interrupted (\(error.code)), not offline")
            return
        }
        let failed = (error.userInfo[NSURLErrorFailingURLErrorKey] as? URL) ?? webView.url
        guard !retried, let url = failed, url != errorURL, url.scheme == "https" else {
            showOffline()
            return
        }
        retried = true
        CAPLog.print("⚡️  HelixOS: load failed (\(error.code)), trying once more")
        DispatchQueue.main.asyncAfter(deadline: .now() + HelixLoadGuard.retryDelay) { [weak webView] in
            _ = webView?.load(URLRequest(url: url))
        }
    }
}
