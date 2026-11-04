import Foundation
import CloudKit

// UI-independent native owner. SQLite persists financial records, the outbox, and engine state.
actor CloudKitSyncManager: CKSyncEngineDelegate {
    static let shared = CloudKitSyncManager()
    private let container = CKContainer(identifier: "iCloud.de.dagobert.app")
    private let zoneID = CKRecordZone.ID(zoneName: "DagobertZone", ownerName: CKCurrentUserDefaultName)
    private var engine: CKSyncEngine?
    private var initializing = false
    private var prepared = false
    private var manualSyncing = false
    private var persistenceFailed = false
    private var lastError: String?
    private var state = "disabled"
    private var activeAccount: String?
    private var eventFailed = false

    private func database() throws -> DagobertDatabase { try DagobertDatabase.sharedStore() }
    private func enabled() throws -> Bool { try database().metadata("syncEnabled") == "1" }
    private func account() async throws -> String {
        guard try await container.accountStatus() == .available else {
            throw DagobertDatabase.StoreError(message: "iCloud ist nicht angemeldet oder nicht verfügbar. Alle lokalen Daten bleiben nutzbar.")
        }
        return try await container.userRecordID().recordName
    }
    private func checkAccount(_ current: String) throws {
        if let bound = try database().metadata("cloudAccount"), bound != current {
            throw DagobertDatabase.StoreError(message: "Der Apple-Account wurde gewechselt. Die Daten des bisherigen Accounts bleiben lokal; ein Upload in den neuen Account ist gesperrt.")
        }
    }
    private func initialize() async throws -> CKSyncEngine {
        guard try enabled() else { throw DagobertDatabase.StoreError(message: "iCloud-Synchronisierung ist deaktiviert.") }
        let current = try await account()
        try checkAccount(current)
        if let engine, activeAccount == current, !persistenceFailed, prepared { return engine }
        guard !initializing else { throw DagobertDatabase.StoreError(message: "iCloud wird gerade vorbereitet. Bitte kurz warten.") }
        initializing = true
        defer { initializing = false; if !prepared { engine = nil } }
        prepared = false
        let db = try database()
        let serialization = try db.metadata("engineState").flatMap { $0.data(using: .utf8) }.map { try JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: $0) }
        var configuration = CKSyncEngine.Configuration(database: container.privateCloudDatabase, stateSerialization: serialization, delegate: self)
        // Merge existing cloud data before scheduling any upload on first activation/restart.
        configuration.automaticallySync = false
        let initial = CKSyncEngine(configuration)
        engine = initial; activeAccount = current; persistenceFailed = false; eventFailed = false
        if try db.metadata("cloudAccount") == nil { try db.setMetadata("cloudAccount", current) }
        try await initial.fetchChanges()
        guard engine === initial, !persistenceFailed, !eventFailed else { throw DagobertDatabase.StoreError(message: lastError ?? "iCloud konnte nicht sicher vorbereitet werden.") }
        let latest = try db.metadata("engineState").flatMap { $0.data(using: .utf8) }.map { try JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: $0) }
        configuration.stateSerialization = latest
        configuration.automaticallySync = true
        let automatic = CKSyncEngine(configuration)
        engine = automatic; prepared = true
        automatic.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        try queuePending(automatic, db: db)
        return automatic
    }
    func setEnabled(_ value: Bool) async throws {
        let db = try database()
        if !value {
            try db.setMetadata("syncEnabled", "0")
            let old = engine; engine = nil; activeAccount = nil; prepared = false
            await old?.cancelOperations()
            state = "disabled"; lastError = nil
            return
        }
        // An explicit user action enables sync. Never clear the account binding to make it work.
        try db.setMetadata("syncEnabled", "1")
        do { _ = try await initialize(); state = "idle"; lastError = nil }
        catch { state = "error"; lastError = message(error); throw DagobertDatabase.StoreError(message: lastError!) }
    }
    func localChangesAvailable() async {
        do {
            guard try enabled() else { return }
            let engine = try await initialize()
            try queuePending(engine, db: database())
        } catch { state = "error"; lastError = message(error) }
    }
    func synchronize() async throws {
        guard !manualSyncing else { throw DagobertDatabase.StoreError(message: "Synchronisierung läuft bereits.") }
        manualSyncing = true; state = "syncing"; eventFailed = false
        defer { manualSyncing = false }
        do {
            let engine = try await initialize()
            try await engine.fetchChanges()
            guard self.engine === engine, !persistenceFailed, !eventFailed else { throw DagobertDatabase.StoreError(message: lastError ?? "Synchronisierung wurde unterbrochen.") }
            try queuePending(engine, db: database())
            try await engine.sendChanges()
            try await engine.fetchChanges()
            guard self.engine === engine, !persistenceFailed, !eventFailed else { throw DagobertDatabase.StoreError(message: lastError ?? "Synchronisierung konnte nicht abgeschlossen werden.") }
            let db = try database()
            if try !db.conflicts().isEmpty { throw DagobertDatabase.StoreError(message: "Es gibt widersprüchliche Änderungen. Bitte die gespeicherten Versionen prüfen.") }
            if try db.pendingCount() == 0 { try db.setMetadata("lastSyncAt", DagobertDatabase.now()) }
            state = "idle"; lastError = nil
        } catch {
            state = "error"; lastError = message(error)
            throw DagobertDatabase.StoreError(message: lastError!)
        }
    }
    private func queuePending(_ engine: CKSyncEngine, db: DagobertDatabase) throws {
        engine.state.add(pendingRecordZoneChanges: try db.pending().map { .saveRecord(CKRecord.ID(recordName: $0.recordID, zoneID: zoneID)) })
    }
    func nextRecordZoneChangeBatch(_ context: CKSyncEngine.SendChangesContext, syncEngine: CKSyncEngine) async -> CKSyncEngine.RecordZoneChangeBatch? {
        guard engine === syncEngine, !persistenceFailed else { return nil }
        do {
            guard try enabled() else { return nil }
            let current = try await account(); try checkAccount(current)
            let db = try database()
            let pending = try db.pending()
            let lookup = Dictionary(uniqueKeysWithValues: pending.map { ($0.recordID, $0) })
            let changes = Array(syncEngine.state.pendingRecordZoneChanges.filter { context.options.scope.contains($0) }.prefix(200))
            var batchRecords = [CKRecord.ID: CKRecord]()
            for change in changes {
                guard case .saveRecord(let recordID) = change else { continue }
                guard let item = lookup[recordID.recordName] else {
                    syncEngine.state.remove(pendingRecordZoneChanges: [.saveRecord(recordID)]); continue
                }
                let record: CKRecord
                if let fields = item.systemFields, !fields.isEmpty {
                    let unarchiver = try NSKeyedUnarchiver(forReadingFrom: fields)
                    unarchiver.requiresSecureCoding = true
                    defer { unarchiver.finishDecoding() }
                    guard let saved = CKRecord(coder: unarchiver) else { throw DagobertDatabase.StoreError(message: "CloudKit-Metadaten sind ungültig.") }
                    record = saved
                } else { record = CKRecord(recordType: "DagobertEntity", recordID: recordID) }
                let data = Data(try DagobertDatabase.json(item.envelope).utf8)
                guard data.count <= 700_000 else { throw DagobertDatabase.StoreError(message: "Ein Datensatz ist zu groß für iCloud. Seine lokale Kopie bleibt erhalten.") }
                record.encryptedValues["payloadEncrypted"] = data as NSData
                batchRecords[recordID] = record
            }
            let snapshot = batchRecords
            return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) { snapshot[$0] }
        } catch {
            eventFailed = true; lastError = message(error); state = "error"
            return nil
        }
    }
    func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        guard engine === syncEngine else { return }
        do {
            let db = try database()
            switch event {
            case .stateUpdate(let update):
                guard !persistenceFailed, !eventFailed, try enabled() else { return }
                let bytes = try JSONEncoder().encode(update.stateSerialization)
                guard let text = String(data: bytes, encoding: .utf8) else { throw DagobertDatabase.StoreError(message: "Sync-Zustand konnte nicht gespeichert werden.") }
                try db.setMetadata("engineState", text)
            case .accountChange(let change):
                switch change.changeType {
                case .signIn(let id):
                    try checkAccount(id.recordName)
                case .signOut, .switchAccounts:
                    // Preserve bound account, outbox, and all financial data. Never auto-transfer.
                    self.engine = nil; activeAccount = nil
                    try db.setMetadata("engineState", nil)
                    state = "error"; lastError = "Der iCloud-Account hat sich geändert. Die Synchronisierung wurde angehalten; deine lokalen Daten bleiben erhalten."
                    await syncEngine.cancelOperations()
                @unknown default:
                    throw DagobertDatabase.StoreError(message: "Unbekannter iCloud-Accountzustand. Synchronisierung bleibt angehalten.")
                }
            case .fetchedRecordZoneChanges(let fetched):
                try db.transaction {
                    for modification in fetched.modifications {
                        let record = modification.record
                        guard record.recordType == "DagobertEntity" else { continue }
                        let envelope = try decode(record)
                        try db.applyRemote(envelope, recordID: record.recordID.recordName, systemFields: systemFields(record))
                    }
                    for deletion in fetched.deletions { try db.serverDeleted(deletion.recordID.recordName) }
                }
                try queuePending(syncEngine, db: db)
            case .sentRecordZoneChanges(let sent):
                for record in sent.savedRecords {
                    let envelope = try decode(record)
                    guard let changeID = envelope["changeId"] as? String else { throw DagobertDatabase.StoreError(message: "Ungültige Sync-Bestätigung.") }
                    try db.acknowledge(record.recordID.recordName, changeID: changeID, systemFields: systemFields(record), sentEnvelope: envelope)
                }
                for failed in sent.failedRecordSaves {
                    if failed.error.code == .serverRecordChanged, let remote = failed.error.serverRecord {
                        try db.applyRemote(decode(remote), recordID: remote.recordID.recordName, systemFields: systemFields(remote))
                    } else if [.zoneNotFound, .unknownItem].contains(failed.error.code) {
                        // A missing zone/record may be a user deletion. Require an explicit decision.
                        try db.setMetadata("syncEnabled", "0")
                        self.engine = nil
                        lastError = "iCloud-Daten wurden entfernt. Lokale Daten bleiben erhalten. Bitte vor erneutem Aktivieren ein Backup exportieren."
                        state = "error"; eventFailed = true
                    } else { eventFailed = true; lastError = message(failed.error); state = "error" }
                }
                if engine === syncEngine { try queuePending(syncEngine, db: db) }
            case .sentDatabaseChanges(let sent):
                if !sent.failedZoneSaves.isEmpty || !sent.failedZoneDeletes.isEmpty {
                    eventFailed = true; state = "error"
                    lastError = "Der iCloud-Datenbereich konnte nicht aktualisiert werden. Deine lokalen Daten bleiben erhalten."
                }
            case .fetchedDatabaseChanges(let fetched):
                if fetched.deletions.contains(where: { $0.zoneID == zoneID }) {
                    try db.setMetadata("syncEnabled", "0"); self.engine = nil; eventFailed = true
                    state = "error"; lastError = "Die iCloud-Daten wurden gelöscht. Deine lokalen Daten bleiben erhalten."
                }
            case .willFetchChanges, .willSendChanges:
                state = "syncing"
            case .didFetchChanges, .didSendChanges:
                if !eventFailed && !persistenceFailed {
                    state = "idle"
                    if try db.pendingCount() == 0 { try db.setMetadata("lastSyncAt", DagobertDatabase.now()) }
                }
            default: break
            }
        } catch {
            // Never advance fetch tokens after a failed local commit.
            persistenceFailed = true; eventFailed = true; state = "error"; lastError = message(error)
            self.engine = nil
            await syncEngine.cancelOperations()
        }
    }
    private func decode(_ record: CKRecord) throws -> [String: Any] {
        guard let data = record.encryptedValues["payloadEncrypted"] as? Data,
              let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DagobertDatabase.StoreError(message: "iCloud-Daten konnten nicht entschlüsselt oder gelesen werden.") }
        return envelope
    }
    private func systemFields(_ record: CKRecord) -> Data {
        let archiver = NSKeyedArchiver(requiringSecureCoding: true)
        record.encodeSystemFields(with: archiver); archiver.finishEncoding()
        return archiver.encodedData
    }
    private func message(_ error: Error) -> String {
        guard let ck = error as? CKError else { return error.localizedDescription }
        switch ck.code {
        case .networkFailure, .networkUnavailable: return "Offline: Änderungen bleiben lokal gespeichert und werden später synchronisiert."
        case .quotaExceeded: return "Der iCloud-Speicher reicht nicht aus. Deine lokalen Daten bleiben erhalten."
        case .requestRateLimited, .serviceUnavailable, .zoneBusy: return "iCloud ist vorübergehend ausgelastet. Die Synchronisierung wird später fortgesetzt."
        case .notAuthenticated, .accountTemporarilyUnavailable: return "iCloud ist nicht verfügbar. Bitte den Apple-Account in den Geräteeinstellungen prüfen."
        default: return "Die iCloud-Synchronisierung konnte nicht abgeschlossen werden. Deine lokalen Daten bleiben erhalten."
        }
    }
    func status() async throws -> [String: Any] {
        let db = try database()
        let isEnabled = try enabled()
        let accountStatus: String
        do {
            switch try await container.accountStatus() {
            case .available: accountStatus = "available"
            case .noAccount: accountStatus = "noAccount"
            case .restricted: accountStatus = "restricted"
            default: accountStatus = "couldNotDetermine"
            }
        } catch { accountStatus = "couldNotDetermine" }
        return ["enabled": isEnabled, "state": isEnabled ? state : "disabled", "lastSyncAt": try db.metadata("lastSyncAt") as Any? ?? NSNull(),
            "pendingChangesCount": try db.pendingCount(), "errorMessage": lastError as Any? ?? NSNull(), "iCloudAccountStatus": accountStatus,
            "conflictsCount": try db.conflicts().count]
    }
}
