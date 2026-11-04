import XCTest

final class OfflineAppTests: XCTestCase {
    private var app: XCUIApplication!
    private var manualAction: XCUIElement {
        app.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", "Manuelle Buchung erfassen", "Neu")).firstMatch
    }
    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(de)", "-AppleLocale", "de_DE", "--ui-diagnostics"]
        enrollBiometrics()
        app.launch()
        XCTAssertFalse(manualAction.exists, "Cold start must not expose financial actions before authentication")
        unlockWithMatchingFace()
    }
    private func enrollBiometrics() {
        // Simulator hardware events, matching TABTestKit Biometrics.m (4050c52).
        XCTAssertEqual(DGEnrollSimulatorBiometrics(), 0)
    }
    private func biometricEvent(matching: Bool) {
        XCTAssertEqual(DGSendSimulatorBiometric(matching), 0)
    }
    private func unlockWithMatchingFace() {
        let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline {
            for owner in [app!, system] {
                let alert = owner.alerts.firstMatch
                if alert.exists && (alert.label.contains("Dagobert") || alert.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] %@", "Face ID")).count > 0) {
                    for label in ["Erlauben", "OK", "Allow"] {
                        let permission = alert.buttons[label]
                        if permission.exists { permission.tap(); break }
                    }
                }
            }
            if manualAction.exists && manualAction.isEnabled && manualAction.isHittable { return }
            biometricEvent(matching: true)
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        let action = manualAction
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true AND enabled == true AND hittable == true"), object: action)
        let loaded = XCTWaiter.wait(for: [ready], timeout: 1) == .completed
        if !loaded {
            capture("native-startup-not-ready")
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "native-startup-accessibility"; hierarchy.lifetime = .keepAlways; add(hierarchy)
        }
        XCTAssertTrue(loaded, "Native profile loading must finish before UI tests")
    }
    override func tearDownWithError() throws { app?.terminate() }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func tapButton(_ name: String) {
        let button = app.buttons[name]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        XCTAssertTrue(button.isHittable)
        button.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }
    func testNativeOfflineNavigation() {
        XCTAssertTrue(app.webViews.firstMatch.exists)
        tapButton("Einstellungen")
        XCTAssertTrue(app.staticTexts["Lokal gespeichert, iCloud optional"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Sicherheit & App-Sperre"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Face ID, Touch ID oder Gerätecode"].exists)
        XCTAssertFalse(app.buttons["Profil-PIN einrichten"].exists)
        XCTAssertFalse(app.buttons["Server-PIN einrichten"].exists)
        XCTAssertFalse(app.buttons["App-Sperre deaktivieren"].exists)
        XCTAssertFalse(app.secureTextFields["Neue App-PIN"].exists)
        capture("native-settings")
        tapButton("Statistik")
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Monatlicher Verlauf")).firstMatch.waitForExistence(timeout: 10))
        capture("native-statistics")
        tapButton("Dashboard")
        XCTAssertTrue(manualAction.exists)
    }
    func testNativeBookingPersistsAcrossAppRestart() {
        let action = manualAction
        capture("native-before-new-booking")
        XCTAssertTrue(action.isHittable)
        action.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        capture("native-after-new-booking-tap")
        let payee = app.textFields["z.B. Supermarkt oder Gehalt"]
        XCTAssertTrue(payee.waitForExistence(timeout: 10))
        let amount = app.textFields["0,00"]
        XCTAssertTrue(amount.exists)
        // A centre tap can place the WebKit caret before the existing amount.
        amount.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let previous = amount.value as? String ?? ""
        amount.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count) + "12,34")
        XCTAssertEqual(amount.value as? String, "12,34")
        payee.tap(); payee.typeText("Synthetischer Mac-Test")
        XCTAssertEqual(payee.value as? String, "Synthetischer Mac-Test")
        capture("native-filled-booking")
        // WebKit can report a covered button as hittable while the keyboard is open.
        let done = app.toolbars.buttons["Fertig"].firstMatch
        if done.exists { done.tap() }
        else if app.frame.width >= 700, app.keyboards.firstMatch.exists {
            // The retained iPad capture shows the keyboard-down key at bottom right.
            app.keyboards.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.90)).tap()
        }
        let keyboardClosed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: app.keyboards.firstMatch)
        let dismissed = XCTWaiter.wait(for: [keyboardClosed], timeout: 10)
        if dismissed != .completed {
            let keyboard = XCTAttachment(string: app.debugDescription)
            keyboard.name = "native-keyboard-accessibility"; keyboard.lifetime = .keepAlways; add(keyboard)
        }
        XCTAssertEqual(dismissed, .completed)
        let save = app.buttons["Buchung anlegen"]
        for _ in 0..<4 where !save.isHittable { app.webViews.firstMatch.swipeUp() }
        XCTAssertTrue(save.isHittable)
        save.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let closed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: payee)
        XCTAssertEqual(XCTWaiter.wait(for: [closed], timeout: 15), .completed, "Successful save must close the editor")
        XCTAssertTrue(app.buttons["Buchungen"].waitForExistence(timeout: 10))
        tapButton("Buchungen")
        XCTAssertTrue(app.staticTexts["Synthetischer Mac-Test"].waitForExistence(timeout: 10))
        capture("native-saved-booking")
        app.terminate(); app.launch(); unlockWithMatchingFace()
        XCTAssertTrue(app.buttons["Buchungen"].waitForExistence(timeout: 20))
        tapButton("Buchungen")
        XCTAssertTrue(app.staticTexts["Synthetischer Mac-Test"].waitForExistence(timeout: 10))
        capture("native-booking-after-process-restart")
    }
    func testNativeRelocksAndRejectsNonmatchingFace() {
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["Dagobert entsperren"].waitForExistence(timeout: 10))
        XCTAssertFalse(manualAction.exists, "Background return must hide financial controls")
        biometricEvent(matching: false)
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        XCTAssertFalse(manualAction.exists, "A nonmatching biometric input must not reveal finances")
        capture("native-rejected-biometric")
        unlockWithMatchingFace()
        XCTAssertTrue(manualAction.exists)
        capture("native-unlocked-after-return")
    }
}
