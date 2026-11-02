import Foundation
import Capacitor

@objc(DagobertPlugin)
public class DagobertPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DagobertPlugin"
    public let jsName = "DagobertPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProfiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createProfile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateProfile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteProfile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockProfile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProfileData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "batchImportTransactions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createManualTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateAccountSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createCategory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCategory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createRule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteRule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadStandardRules", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importBackup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resetProfileData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSyncStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSyncEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "triggerSync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticateBiometrics", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canUseBiometrics", returnType: CAPPluginReturnPromise)
    ]

    private let db = DagobertDatabase.shared
    private let sync = CloudKitSyncManager.shared
    private let sec = SecurityManager.shared

    // MARK: - Profiles

    @objc func getProfiles(_ call: CAPPluginCall) {
        let profiles = db.getProfiles()
        call.resolve(["profiles": profiles])
    }

    @objc func createProfile(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.reject("Name ist erforderlich")
            return
        }
        let icon = call.getString("icon") ?? "User"
        let color = call.getString("color") ?? "#0A84FF"
        let pin = call.getString("pin")

        if let prof = db.createProfile(name: name, icon: icon, color: color, pin: pin) {
            call.resolve(prof)
        } else {
            call.reject("Fehler beim Erstellen des Profils")
        }
    }

    @objc func updateProfile(_ call: CAPPluginCall) {
        guard let id = call.getString("profileId") else {
            call.reject("profileId ist erforderlich")
            return
        }
        let name = call.getString("name")
        let icon = call.getString("icon")
        let color = call.getString("color")
        let pin = call.getString("pin")
        let removePin = call.getBool("removePin") ?? false

        let ok = db.updateProfile(id: id, name: name, icon: icon, color: color, pin: pin, removePin: removePin)
        call.resolve(["success": ok, "hasPin": (pin != nil && !pin!.isEmpty) && !removePin])
    }

    @objc func deleteProfile(_ call: CAPPluginCall) {
        guard let id = call.getString("profileId") else {
            call.reject("profileId ist erforderlich")
            return
        }
        let ok = db.deleteProfile(id: id)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Das letzte Profil kann nicht gelöscht werden")
        }
    }

    @objc func unlockProfile(_ call: CAPPluginCall) {
        guard let id = call.getString("profileId"),
              let pin = call.getString("pin") else {
            call.reject("profileId und pin erforderlich")
            return
        }
        let ok = db.unlockProfile(id: id, pin: pin)
        call.resolve(["success": ok])
    }

    // MARK: - Profile Data

    @objc func getProfileData(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId") else {
            call.reject("profileId erforderlich")
            return
        }
        if let data = db.getProfileData(profileId: profileId) {
            call.resolve(data)
        } else {
            call.reject("Profil nicht gefunden")
        }
    }

    // MARK: - Transactions

    @objc func batchImportTransactions(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let txs = call.getArray("transactions") as? [[String: Any]] else {
            call.reject("profileId und transactions erforderlich")
            return
        }
        let cp = call.getObject("accountCheckpoint")
        let res = db.batchImportTransactions(profileId: profileId, transactions: txs, accountCheckpoint: cp)
        call.resolve(res)
    }

    @objc func createManualTransaction(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let tx = call.getObject("transaction") else {
            call.reject("profileId und transaction erforderlich")
            return
        }
        if let id = db.createManualTransaction(profileId: profileId, transaction: tx) {
            call.resolve(["id": id])
        } else {
            call.reject("Fehler beim Erstellen der manuellen Buchung")
        }
    }

    @objc func updateTransaction(_ call: CAPPluginCall) {
        guard let id = call.getString("id"),
              let tx = call.getObject("transaction") else {
            call.reject("id und transaction erforderlich")
            return
        }
        let ok = db.updateTransaction(id: id, transaction: tx)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Aktualisieren der Buchung")
        }
    }

    @objc func deleteTransaction(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("id erforderlich")
            return
        }
        let ok = db.deleteTransaction(id: id)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Löschen der Buchung")
        }
    }

    // MARK: - Account Settings

    @objc func updateAccountSettings(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let id = call.getString("id") else {
            call.reject("profileId und id erforderlich")
            return
        }
        let initialBalance = call.getDouble("initialBalance")
        let initialBalanceDate = call.getString("initialBalanceDate")
        let checkpointBalance = call.getDouble("checkpointBalance")
        let checkpointDate = call.getString("checkpointDate")

        let ok = db.updateAccountSettings(
            profileId: profileId,
            id: id,
            initialBalance: initialBalance,
            initialBalanceDate: initialBalanceDate,
            checkpointBalance: checkpointBalance,
            checkpointDate: checkpointDate
        )
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Speichern der Kontoeinstellungen")
        }
    }

    // MARK: - Categories & Rules

    @objc func createCategory(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let cat = call.getObject("category") else {
            call.reject("profileId und category erforderlich")
            return
        }
        if let created = db.createCategory(profileId: profileId, category: cat) {
            call.resolve(["category": created])
        } else {
            call.reject("Fehler beim Erstellen der Kategorie")
        }
    }

    @objc func deleteCategory(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let id = call.getString("id") else {
            call.reject("profileId und id erforderlich")
            return
        }
        let ok = db.deleteCategory(profileId: profileId, id: id)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Löschen der Kategorie")
        }
    }

    @objc func createRule(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let rule = call.getObject("rule") else {
            call.reject("profileId und rule erforderlich")
            return
        }
        let ok = db.createRule(profileId: profileId, rule: rule)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Speichern der Regel")
        }
    }

    @objc func deleteRule(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let id = call.getString("id") else {
            call.reject("profileId und id erforderlich")
            return
        }
        let ok = db.deleteRule(profileId: profileId, id: id)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Löschen der Regel")
        }
    }

    @objc func loadStandardRules(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let rulesJson = call.getString("standardRulesJson") else {
            call.reject("profileId und standardRulesJson erforderlich")
            return
        }
        let res = db.loadStandardRules(profileId: profileId, standardRulesJson: rulesJson)
        call.resolve(res)
    }

    // MARK: - Backup & Restore

    @objc func exportBackup(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId") else {
            call.reject("profileId erforderlich")
            return
        }
        guard let data = db.getProfileData(profileId: profileId) else {
            call.reject("Profil nicht gefunden")
            return
        }
        let prof = data["profile"] as? [String: Any]

        var payload: [String: Any] = [
            "format": "dagobert_backup",
            "schemaVersion": 1,
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
            "sourcePlatform": "ios",
            "profileId": profileId,
            "profileName": (prof?["name"] as? String) ?? "Privat",
            "accounts": data["accounts"] ?? [],
            "categories": data["categories"] ?? [],
            "rules": data["rules"] ?? [],
            "transactions": data["transactions"] ?? [],
            "bankTemplates": data["bankTemplates"] ?? []
        ]

        if call.getBool("includeAllProfiles") == true {
            payload["profiles"] = db.getProfiles()
        }

        call.resolve(["backup": payload])
    }

    @objc func importBackup(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId"),
              let payload = call.getObject("data") else {
            call.reject("profileId und data erforderlich")
            return
        }
        let mode = call.getString("mode") ?? "replace"
        let ok = db.importProfileBackup(profileId: profileId, payload: payload, mode: mode)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Wiederherstellen des Backups")
        }
    }

    @objc func resetProfileData(_ call: CAPPluginCall) {
        guard let profileId = call.getString("profileId") else {
            call.reject("profileId erforderlich")
            return
        }
        let ok = db.resetProfileData(profileId: profileId)
        if ok {
            call.resolve(["success": true])
        } else {
            call.reject("Fehler beim Zurücksetzen des Profils")
        }
    }

    // MARK: - CloudKit Sync

    @objc func getSyncStatus(_ call: CAPPluginCall) {
        sync.getStatusDictionary { dict in
            call.resolve(dict)
        }
    }

    @objc func setSyncEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else {
            call.reject("enabled Parameter erforderlich")
            return
        }
        sync.isEnabled = enabled
        call.resolve(["enabled": enabled])
    }

    @objc func triggerSync(_ call: CAPPluginCall) {
        sync.performSync { success, error in
            if success {
                call.resolve(["success": true])
            } else {
                call.reject(error ?? "Sync fehlgeschlagen")
            }
        }
    }

    // MARK: - Biometrics & Device Authentication

    @objc func canUseBiometrics(_ call: CAPPluginCall) {
        let available = sec.canUseBiometrics()
        call.resolve(["available": available])
    }

    @objc func authenticateBiometrics(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "Authentifizierung für Dagobert"
        sec.authenticateWithDevice(reason: reason) { success, error in
            if success {
                call.resolve(["success": true])
            } else {
                call.reject(error ?? "Authentifizierung abgebrochen")
            }
        }
    }
}
