import UIKit
import Capacitor
#if DEBUG
import WebKit
#endif

final class DagobertBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(DagobertPlugin())
        webView?.backgroundColor = .systemBackground
        webView?.scrollView.backgroundColor = .systemBackground
        webView?.scrollView.bounces = false
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-diagnostics"), let webView {
            webView.configuration.userContentController.add(UITestDiagnostics(), name: "dagobertUITest")
            webView.configuration.userContentController.addUserScript(WKUserScript(source: UITestDiagnostics.script,
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        #endif
    }
}

#if DEBUG
// Explicit synthetic-test diagnostics only. No input values or financial records are logged.
final class UITestDiagnostics: NSObject, WKScriptMessageHandler {
    private static let journalLock = NSLock()
    static let script = #"""
    (() => {
      const report = (kind, e) => {
        const rect = b => { const r=b.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
        const name = b => b?.getAttribute('aria-label') || b?.title || b?.textContent?.trim().slice(0,50) || '';
        const main = document.querySelector('main');
        const header=document.querySelector('header'), dock=document.querySelector('nav');
        window.webkit.messageHandlers.dagobertUITest.postMessage({kind, time:performance.now(),
          point:e ? [e.clientX ?? e.changedTouches?.[0]?.clientX, e.clientY ?? e.changedTouches?.[0]?.clientY] : [],
          target:e?.target?.tagName || '', button:name(e?.target?.closest?.('button')),
          viewport:{height:innerHeight,width:innerWidth,scrollY,visualHeight:visualViewport?.height,offsetTop:visualViewport?.offsetTop},
          activeTab:document.querySelector('nav button[aria-current=page]')?.textContent?.trim() || '',
          mainScroll:main?.scrollTop, statistics:!!document.getElementById('statistics-months-title'),
          layout:{header:header?rect(header):null,dock:dock?rect(dock):null,
            headerPadding:header?parseFloat(getComputedStyle(header).paddingTop):0,
            dockPadding:dock?parseFloat(getComputedStyle(dock).paddingBottom):0,
            dockMargin:dock?parseFloat(getComputedStyle(dock).marginBottom):0},
          nav:[...document.querySelectorAll('nav button')].map(b=>({name:name(b),rect:rect(b),
            hit:name(document.elementFromPoint(b.getBoundingClientRect().x+b.clientWidth/2,b.getBoundingClientRect().y+b.clientHeight/2)?.closest('button'))}))});
      };
      for(const kind of ['touchstart','touchend','click']) document.addEventListener(kind,e=>{
        report(kind,e); setTimeout(()=>report('after-'+kind),150);
      },true);
      addEventListener('DOMContentLoaded',()=>report('loaded'));
    })();
    """#
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let view = message.webView, let body = message.body as? [String: Any] else { return }
        var row = body
        row["appUnlocked"] = SecurityManager.shared.appUnlocked
        row["contentHidden"] = view.accessibilityElementsHidden
        row["native"] = ["offsetY": view.scrollView.contentOffset.y,
            "insetTop": view.scrollView.adjustedContentInset.top, "insetBottom": view.scrollView.adjustedContentInset.bottom,
            "height": view.bounds.height, "contentHeight": view.scrollView.contentSize.height,
            "safeTop": view.window?.safeAreaInsets.top ?? 0, "safeBottom": view.window?.safeAreaInsets.bottom ?? 0]
        Self.record(row)
    }
    static func record(_ row: [String: Any]) {
        guard ProcessInfo.processInfo.arguments.contains("--ui-diagnostics") else { return }
        journalLock.lock(); defer { journalLock.unlock() }
        do {
            let file = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("ui-diagnostics.jsonl")
            var data = try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]); data.append(0x0a)
            if FileManager.default.fileExists(atPath: file.path) {
                let handle = try FileHandle(forWritingTo: file); defer { try? handle.close() }
                _ = try handle.seekToEnd(); try handle.write(contentsOf: data)
            } else { try data.write(to: file, options: .atomic) }
        } catch { assertionFailure("Synthetic UI diagnostic recording failed") }
    }
}
#endif

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var shield: UIView?
    private var lockStatus: UILabel?
    private var authenticating = false
    private var autoUnlockOnActivation = true
    private var activation = UUID()
    private var documentError: String?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = DagobertBridgeViewController()
        self.window = window
        cover()
        window.makeKeyAndVisible()
        if let shield { window.bringSubviewToFront(shield) }
        recordSecurity("cold-start")
        for context in connectionOptions.urlContexts where context.url.isFileURL { receiveDocument(context.url) }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }
    func sceneWillResignActive(_ scene: UIScene) {
        // System authentication temporarily deactivates the scene. Its own result owns that transition.
        cover()
        guard !authenticating && !SecurityManager.shared.authenticationInProgress else { return }
        activation = UUID()
        autoUnlockOnActivation = true
        SecurityManager.shared.lockApp()
        recordSecurity("inactive")
    }
    func sceneDidEnterBackground(_ scene: UIScene) {
        activation = UUID()
        autoUnlockOnActivation = true
        cover()
        SecurityManager.shared.lockApp()
        recordSecurity("background")
    }
    func sceneDidBecomeActive(_ scene: UIScene) {
        guard !authenticating else { return }
        if SecurityManager.shared.appUnlocked { reveal(); Task { await CloudKitSyncManager.shared.localChangesAvailable() } }
        else {
            cover()
            if autoUnlockOnActivation { autoUnlockOnActivation = false; unlock() }
        }
    }
    private func cover() {
        guard let window else { return }
        (window.rootViewController as? CAPBridgeViewController)?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('dagobertAppLocked'))", completionHandler: nil)
        window.rootViewController?.view.accessibilityElementsHidden = true
        if let shield { window.bringSubviewToFront(shield); return }
        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = .systemBackground
        cover.accessibilityViewIsModal = true
        cover.accessibilityIdentifier = "app-privacy-shield"
        let title = UILabel()
        title.text = "Dagobert"
        title.font = .preferredFont(forTextStyle: .largeTitle)
        title.adjustsFontForContentSizeCategory = true
        title.textAlignment = .center
        let button = UIButton(type: .system)
        button.setTitle("Dagobert entsperren", for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.addTarget(self, action: #selector(unlock), for: .touchUpInside)
        let status = UILabel()
        status.text = "Face ID, Touch ID oder dein Gerätecode schützen die gesamte App."
        status.font = .preferredFont(forTextStyle: .body)
        status.adjustsFontForContentSizeCategory = true
        status.numberOfLines = 0
        status.textAlignment = .center
        status.accessibilityIdentifier = "app-lock-status"
        lockStatus = status
        let stack = UIStackView(arrangedSubviews: [title, status, button])
        stack.axis = .vertical; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(stack)
        NSLayoutConstraint.activate([stack.centerXAnchor.constraint(equalTo: cover.centerXAnchor), stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: cover.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: cover.safeAreaLayoutGuide.trailingAnchor, constant: -24), button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48)])
        window.addSubview(cover); shield = cover
    }
    private func reveal() {
        shield?.removeFromSuperview(); shield = nil; lockStatus = nil
        window?.rootViewController?.view.accessibilityElementsHidden = false
        recordSecurity("revealed")
        (window?.rootViewController as? CAPBridgeViewController)?.webView?.evaluateJavaScript("window.dispatchEvent(new Event('dagobertAppUnlocked'))", completionHandler: nil)
        showDocumentError()
    }
    private func recordSecurity(_ phase: String) {
        #if DEBUG
        let allowed: Bool
        do { try SecurityManager.shared.requireAppAccess(); allowed = true } catch { allowed = false }
        UITestDiagnostics.record(["kind": "security", "phase": phase, "allowed": allowed,
            "contentHidden": window?.rootViewController?.view.accessibilityElementsHidden ?? true])
        #endif
    }
    @objc private func unlock() {
        guard !authenticating else { return }
        autoUnlockOnActivation = false
        authenticating = true
        let token = activation
        Task { @MainActor in
            defer { authenticating = false }
            do {
                guard try await SecurityManager.shared.authenticate(reason: "Deine Finanzdaten in Dagobert öffnen"),
                      token == activation, window?.windowScene?.activationState == .foregroundActive else { return }
                reveal()
                // The native-ready event retries data loading without discarding forms or TAN state.
                await CloudKitSyncManager.shared.localChangesAvailable()
            } catch { cover(); lockStatus?.text = error.localizedDescription }
        }
    }
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts where context.url.isFileURL { receiveDocument(context.url) }
        let navigation = Set(URLContexts.filter { !$0.url.isFileURL })
        SceneDelegateProxy.shared.scene(scene, openURLContexts: navigation)
    }
    private func receiveDocument(_ url: URL) {
        do { try DocumentInbox.sharedStore().stage(url) }
        catch { documentError = "Die Datei konnte nicht übernommen werden. Bitte eine CSV- oder JSON-Datei mit höchstens 50 MB aus der Dateien-App öffnen." }
        showDocumentError()
    }
    private func showDocumentError() {
        guard shield == nil, SecurityManager.shared.appUnlocked, let message = documentError,
              let controller = window?.rootViewController, controller.presentedViewController == nil else { return }
        documentError = nil
        let alert = UIAlertController(title: "Datei öffnen", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        controller.present(alert, animated: true)
    }
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
