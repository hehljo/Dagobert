import UIKit
import Capacitor
import CloudKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var blurEffectView: UIVisualEffectView?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Register for CloudKit push notifications
        application.registerForRemoteNotifications()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Privacy protection: Cover sensitive banking/financial contents in the iOS App Switcher
        guard let window = self.window, blurEffectView == nil else { return }
        let blurEffect = UIBlurEffect(style: .systemThinMaterial)
        let blur = UIVisualEffectView(effect: blurEffect)
        blur.frame = window.bounds
        blur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        blur.tag = 9999
        window.addSubview(blur)
        self.blurEffectView = blur
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Remove privacy protection overlay when app becomes active
        if let blur = self.blurEffectView {
            UIView.animate(withDuration: 0.15, animations: {
                blur.alpha = 0
            }) { _ in
                blur.removeFromSuperview()
                self.blurEffectView = nil
            }
        }
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable : Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        // Process silent CloudKit notifications
        guard let dict = userInfo as? [String: NSObject] else {
            completionHandler(.noData)
            return
        }
        let notification = CKNotification(fromRemoteNotificationDictionary: dict)
        if notification?.notificationType == .recordZone {
            CloudKitSyncManager.shared.performSync { success, _ in
                completionHandler(success ? .newData : .failed)
            }
        } else {
            completionHandler(.noData)
        }
    }

    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
