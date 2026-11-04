import Foundation
import Capacitor
import UIKit

@objc(DagobertPlugin)
public final class DagobertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DagobertPlugin"
    public let jsName = "DagobertPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        "getProfiles", "createProfile", "updateProfile", "deleteProfile", "unlockProfile", "getProfileData",
        "batchImportTransactions", "createManualTransaction", "updateTransaction", "deleteTransaction", "updateAccountSettings",
        "createCategory", "deleteCategory", "createRule", "deleteRule", "loadStandardRules", "importRulesPackage", "exportBackup", "importBackup",
        "resetProfileData", "getSyncStatus", "setSyncEnabled", "triggerSync", "authenticateBiometrics", "canUseBiometrics",
        "getDeviceSecurity", "getAppLockState", "setAppLockEnabled", "shareBackup", "getConflicts", "resolveConflict", "getRecoveryBackups", "exportRecoveryBackup",
        "getIncomingDocuments", "readIncomingDocument", "acknowledgeIncomingDocument", "comdirect"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let worker = DispatchQueue(label: "de.dagobert.bridge", qos: .userInitiated)
    private var shareURL: URL?
    private var inboxObserver: NSObjectProtocol?
    // Only a boolean is public while locked; financial methods still use perform's guard.
    @objc func getAppLockState(_ call: CAPPluginCall) { call.resolve(["unlocked": SecurityManager.shared.appUnlocked]) }
    private var bankSessions: [String: (profile: String, session: ComdirectSession)] = [:]
    private var bankAttempts: [String: [Date]] = [:]
    @objc func comdirect(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let operation = required(call, "operation") else { return }
        perform(call, profile: profile) { _ in
            self.bankSessions = self.bankSessions.filter { $0.value.session.expiresAt > Date() }
            var body = call.options as? [String: Any] ?? [:]
            if operation == "saved-access" {
                let saved = try BankAccessStore.load(profile)
                return ["saved": saved != nil, "pinStored": !(saved?["password"] ?? "").isEmpty, "canSave": true]
            }
            if operation == "forget-access" { try BankAccessStore.remove(profile); return ["success": true] }
            if operation == "login" {
                if call.getBool("useSaved") == true {
                    guard let saved = try BankAccessStore.load(profile) else { throw ComdirectSession.BankError(message: "Es ist kein Bankzugang gespeichert.") }
                    for (key, value) in saved where key != "password" || (body["password"] as? String ?? "").isEmpty { body[key] = value }
                }
                var attempts = (self.bankAttempts[profile] ?? []).filter { $0 > Date().addingTimeInterval(-900) }
                guard attempts.count < 3, self.bankSessions.count < 50 else {
                    throw ComdirectSession.BankError(message: "Zu viele neue TAN-Anforderungen. Bitte zuerst im comdirect-Onlinebanking anmelden und später erneut versuchen.")
                }
                attempts.append(Date()); self.bankAttempts[profile] = attempts
                let session = ComdirectSession()
                var result = try session.login(body)
                try SecurityManager.shared.requireAppAccess()
                if call.getBool("saveAccess") == true { try BankAccessStore.save(profile, body, includePin: call.getBool("savePin") == true) }
                let handle = UUID().uuidString
                self.bankSessions[handle] = (profile, session); result["sessionId"] = handle
                self.worker.asyncAfter(deadline: .now() + max(0, session.expiresAt.timeIntervalSinceNow)) { [self] in
                    self.bankSessions.removeValue(forKey: handle)
                }
                return result
            }
            guard let handle = call.getString("sessionId"), let entry = self.bankSessions[handle], entry.profile == profile else {
                throw ComdirectSession.BankError(message: "Bitte zuerst mit comdirect verbinden.")
            }
            do {
                let result: [String: Any]
                switch operation {
                case "confirm": result = try entry.session.confirm(body)
                case "transactions": result = try entry.session.transactions(body)
                case "disconnect": self.bankSessions.removeValue(forKey: handle); entry.session.disconnect(); result = ["success": true]
                default: throw ComdirectSession.BankError(message: "Unbekannter Bankvorgang.")
                }
                try SecurityManager.shared.requireAppAccess()
                return result
            } catch { self.bankSessions.removeValue(forKey: handle); throw error }
        }
    }
    public override func load() {
        inboxObserver = NotificationCenter.default.addObserver(forName: DocumentInbox.changed, object: nil, queue: .main) { [weak self] _ in
            self?.notifyListeners("documentInboxChanged", data: [:])
        }
    }
    deinit { if let inboxObserver { NotificationCenter.default.removeObserver(inboxObserver) } }
    @objc func getIncomingDocuments(_ call: CAPPluginCall) {
        perform(call) { _ in ["documents": try DocumentInbox.sharedStore().pending()] }
    }
    @objc func readIncomingDocument(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        perform(call) { _ in try DocumentInbox.sharedStore().read(id) }
    }
    @objc func acknowledgeIncomingDocument(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        perform(call) { _ in try DocumentInbox.sharedStore().acknowledge(id); return ["success": true] }
    }
    private func perform(_ call: CAPPluginCall, profile: String? = nil, mutation: Bool = false,
                         _ body: @escaping (DagobertDatabase) throws -> [String: Any]) {
        worker.async {
            do {
                try SecurityManager.shared.requireAppAccess()
                #if DEBUG
                UITestDiagnostics.record(["kind": "bridge-access", "allowed": true])
                #endif
                let db = try DagobertDatabase.sharedStore()
                if let profile { try SecurityManager.shared.requireProfile(profile, database: db) }
                let result = try body(db)
                call.resolve(result)
                if mutation { Task { await CloudKitSyncManager.shared.localChangesAvailable() } }
            } catch {
                #if DEBUG
                UITestDiagnostics.record(["kind": "bridge-access", "allowed": SecurityManager.shared.appUnlocked])
                #endif
                call.reject(error.localizedDescription, SecurityManager.shared.appUnlocked ? "LOCAL_DATA_ERROR" : "APP_LOCKED", error)
            }
        }
    }
    private func required(_ call: CAPPluginCall, _ key: String) -> String? {
        guard let value = call.getString(key), !value.isEmpty else { call.reject("\(key) fehlt."); return nil }
        return value
    }
    @objc func getProfiles(_ call: CAPPluginCall) {
        perform(call) { db in
            guard let defaults = call.getObject("defaults") else { throw DagobertDatabase.StoreError(message: "App-Vorlagen fehlen.") }
            try db.bootstrap(defaults)
            return ["profiles": try db.profiles().map { profile in
                var visible = profile; visible["hasPin"] = false; return visible
            }]
        }
    }
    @objc func createProfile(_ call: CAPPluginCall) {
        guard let name = required(call, "name") else { return }
        perform(call, mutation: true) { db in
            guard call.getString("pin") == nil else { throw SecurityManager.SecurityError.profilePinUnavailable }
            return try db.createProfile(name, icon: call.getString("icon") ?? "User", color: call.getString("color") ?? "#0A84FF", pinHash: nil)
        }
    }
    @objc func updateProfile(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId") else { return }
        perform(call, profile: id, mutation: true) { db in
            guard call.getString("pin") == nil && call.getBool("removePin") != true else { throw SecurityManager.SecurityError.profilePinUnavailable }
            try db.transaction {
                try db.updateProfile(id, ["name": call.getString("name"), "icon": call.getString("icon"), "color": call.getString("color")].compactMapValues { $0 })
            }
            return ["success": true, "hasPin": false]
        }
    }
    @objc func deleteProfile(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId") else { return }
        perform(call, profile: id, mutation: true) { db in try db.deleteProfile(id); return ["success": true] }
    }
    @objc func unlockProfile(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId"), let pin = call.getString("pin") else { return }
        perform(call) { db in ["success": try SecurityManager.shared.unlockProfile(id, pin: pin, database: db)] }
    }
    @objc func getProfileData(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId") else { return }
        perform(call, profile: id) { db in
            var data = try db.profileData(id)
            if var profile = data["profile"] as? [String: Any] {
                profile["hasPin"] = false; data["profile"] = profile
            }
            return data
        }
    }
    @objc func batchImportTransactions(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId"), let values = call.getArray("transactions", JSObject.self) else { call.reject("Buchungen fehlen."); return }
        perform(call, profile: id, mutation: true) { try $0.batchImport(id, values, call.getObject("accountCheckpoint"), appendOnly: call.getBool("appendOnly") ?? false, reviewedHashes: Set(call.getArray("reviewedHashes", String.self) ?? [])) }
    }
    @objc func createManualTransaction(_ call: CAPPluginCall) {
        guard let id = required(call, "profileId"), var value = call.getObject("transaction") else { call.reject("Buchung fehlt."); return }
        value["isManual"] = true
        value.removeValue(forKey: "id"); value.removeValue(forKey: "syncId")
        perform(call, profile: id, mutation: true) { db in ["id": try db.saveEntity(id, "transactions", value)["id"]!] }
    }
    @objc func updateTransaction(_ call: CAPPluginCall) {
        guard let id = required(call, "id"), let value = call.getObject("transaction") else { call.reject("Buchung fehlt."); return }
        perform(call, mutation: true) { db in
            try SecurityManager.shared.requireProfile(db.transactionProfile(id), database: db)
            try db.editTransaction(id, value); return ["success": true]
        }
    }
    @objc func deleteTransaction(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        perform(call, mutation: true) { db in
            let profile = try db.transactionProfile(id); try SecurityManager.shared.requireProfile(profile, database: db)
            try db.deleteEntity(profile, "transactions", id); return ["success": true]
        }
    }
    @objc func updateAccountSettings(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let id = required(call, "id") else { return }
        perform(call, profile: profile, mutation: true) { db in try db.updateAccount(profile, id, call.options as? [String: Any] ?? [:]); return ["success": true] }
    }
    @objc func createCategory(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let value = call.getObject("category") else { call.reject("Kategorie fehlt."); return }
        perform(call, profile: profile, mutation: true) { ["category": try $0.saveEntity(profile, "categories", value)] }
    }
    @objc func importRulesPackage(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let categories = call.getArray("categories", JSObject.self),
              let rules = call.getArray("rules", JSObject.self), let expectedCategories = call.getArray("expectedCategories", JSObject.self),
              let expectedRules = call.getArray("expectedRules", JSObject.self) else { call.reject("Regeln-Datei ist unvollständig."); return }
        perform(call, profile: profile, mutation: true) { db in
            try db.importRulesPackage(profile, categories: categories, rules: rules, expectedCategories: expectedCategories, expectedRules: expectedRules)
        }
    }
    @objc func createRule(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let value = call.getObject("rule") else { call.reject("Regel fehlt."); return }
        perform(call, profile: profile, mutation: true) { db in _ = try db.saveEntity(profile, "rules", value); return ["success": true] }
    }
    @objc func deleteCategory(_ call: CAPPluginCall) { delete(call, kind: "categories") }
    @objc func deleteRule(_ call: CAPPluginCall) { delete(call, kind: "rules") }
    private func delete(_ call: CAPPluginCall, kind: String) {
        guard let profile = required(call, "profileId"), let id = required(call, "id") else { return }
        perform(call, profile: profile, mutation: true) { db in try db.deleteEntity(profile, kind, id); return ["success": true] }
    }
    @objc func loadStandardRules(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let json = call.getString("standardRulesJson"), let bytes = json.data(using: .utf8) else { call.reject("Regeln fehlen."); return }
        perform(call, profile: profile, mutation: true) { db in
            guard let root = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let rules = root["rules"] as? [[String: Any]] else { throw DagobertDatabase.StoreError(message: "Ungültige Standardregeln.") }
            return try db.loadStandardRules(profile, rules)
        }
    }
    @objc func exportBackup(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId") else { return }
        perform(call, profile: profile) { db in
            let all = call.getBool("includeAllProfiles") == true
            if all { for p in try db.profiles() { if let id = p["id"] as? String { try SecurityManager.shared.requireProfile(id, database: db) } } }
            return ["backup": try db.exportBackup(profile, all: all)]
        }
    }
    @objc func importBackup(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId"), let payload = call.getObject("data") else { call.reject("Backup fehlt."); return }
        perform(call, profile: profile, mutation: true) { db in
            let mode = call.getString("mode") ?? "merge"
            if mode != "new_profile" {
                for p in payload["additionalProfiles"] as? [[String: Any]] ?? [] {
                    if let id = p["profileId"] as? String { try SecurityManager.shared.requireProfile(id, database: db) }
                }
            }
            if mode == "replace" {
                // Persist a recoverable snapshot before any replace, including all affected profiles.
                let backup = try db.exportBackup(profile, all: true)
                try db.setMetadata("recovery:\(UUID().uuidString.lowercased())", DagobertDatabase.json(backup))
            }
            return ["success": true, "profileIds": try db.importBackup(profile, payload, mode: mode)]
        }
    }
    @objc func resetProfileData(_ call: CAPPluginCall) {
        guard let profile = required(call, "profileId") else { return }
        perform(call, profile: profile, mutation: true) { db in
            try db.setMetadata("recovery:\(UUID().uuidString.lowercased())", DagobertDatabase.json(db.exportBackup(profile, all: false)))
            try db.resetProfile(profile); return ["success": true]
        }
    }
    @objc func getSyncStatus(_ call: CAPPluginCall) {
        Task { do { try SecurityManager.shared.requireAppAccess(); call.resolve(try await CloudKitSyncManager.shared.status()) } catch { call.reject("iCloud-Status ist nicht verfügbar.") } }
    }
    @objc func setSyncEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else { call.reject("Auswahl fehlt."); return }
        Task {
            do { try SecurityManager.shared.requireAppAccess(); try await CloudKitSyncManager.shared.setEnabled(enabled); call.resolve(["enabled": enabled]) }
            catch { call.reject(error.localizedDescription) }
        }
    }
    @objc func triggerSync(_ call: CAPPluginCall) {
        Task { do { try SecurityManager.shared.requireAppAccess(); try await CloudKitSyncManager.shared.synchronize(); call.resolve(["success": true]) } catch { call.reject(error.localizedDescription) } }
    }
    @objc func canUseBiometrics(_ call: CAPPluginCall) { call.resolve(["available": SecurityManager.shared.canAuthenticate()]) }
    @objc func authenticateBiometrics(_ call: CAPPluginCall) {
        Task { @MainActor in
            do { call.resolve(["success": try await SecurityManager.shared.authenticate(reason: call.getString("reason") ?? "Dagobert entsperren")]) }
            catch { call.reject("Authentifizierung abgebrochen oder nicht verfügbar.") }
        }
    }
    @objc func getDeviceSecurity(_ call: CAPPluginCall) {
        do { call.resolve(["enabled": try SecurityManager.shared.appLockEnabled()]) } catch { call.reject(error.localizedDescription) }
    }
    @objc func setAppLockEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else { call.reject("Auswahl fehlt."); return }
        Task { @MainActor in
            do { try SecurityManager.shared.requireAppAccess(); try await SecurityManager.shared.setAppLock(enabled); call.resolve(["enabled": enabled]) }
            catch { call.reject("Die App-Sperre wurde nicht geändert.") }
        }
    }
    @objc func getConflicts(_ call: CAPPluginCall) {
        perform(call) { db in
            let conflicts = try db.conflicts()
            for c in conflicts { if let versions = c["versions"] as? [[String: Any]], let profile = versions.first?["profileId"] as? String { try SecurityManager.shared.requireProfile(profile, database: db) } }
            return ["conflicts": conflicts]
        }
    }
    @objc func resolveConflict(_ call: CAPPluginCall) {
        guard let id = required(call, "id"), let version = call.getInt("version") else { call.reject("Auswahl fehlt."); return }
        perform(call, mutation: true) { db in
            guard let record = try db.records(nil, "conflicts").first(where: { $0.id == id }) else { throw DagobertDatabase.StoreError(message: "Konflikt nicht gefunden.") }
            try SecurityManager.shared.requireProfile(record.profileID, database: db)
            try db.resolveConflict(id, version: version); return ["success": true]
        }
    }
    @objc func getRecoveryBackups(_ call: CAPPluginCall) {
        perform(call) { db in ["backups": try db.recoveryBackups()] }
    }
    @objc func exportRecoveryBackup(_ call: CAPPluginCall) {
        guard let id = required(call, "id") else { return }
        perform(call) { db in
            guard id.hasPrefix("recovery:"), let text = try db.metadata(id), let bytes = text.data(using: .utf8), let backup = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw DagobertDatabase.StoreError(message: "Sicherung nicht gefunden.") }
            for p in try db.profiles() { if let id = p["id"] as? String { try SecurityManager.shared.requireProfile(id, database: db) } }
            return ["backup": backup]
        }
    }
    @objc func shareBackup(_ call: CAPPluginCall) {
        guard let text = call.getString("json"), let bytes = text.data(using: .utf8), let controller = bridge?.viewController else { call.reject("Sicherung fehlt."); return }
        do {
            try SecurityManager.shared.requireAppAccess()
            // A protected file, not thousands of bank records pasted into a share text field.
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("DagobertShare", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
            let prefix = call.getString("kind") == "rules" ? "dagobert_regeln" : "dagobert_backup"
            let url = dir.appendingPathComponent("\(prefix)_\(UUID().uuidString.lowercased()).json")
            try bytes.write(to: url, options: [.atomic, .completeFileProtection])
            shareURL = url
            DispatchQueue.main.async {
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = controller.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    // Retain this protected file for the OS share extension; do not delete it during handoff.
                    if error != nil { call.reject("Die Sicherung konnte nicht geteilt werden.") }
                    else { call.resolve(["completed": completed]) }
                }
                controller.present(sheet, animated: true)
            }
        } catch { call.reject("Die geschützte Sicherungsdatei konnte nicht erstellt werden.") }
    }
}
