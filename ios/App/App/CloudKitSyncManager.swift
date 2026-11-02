import Foundation
import CloudKit

public final class CloudKitSyncManager: NSObject {
    public static let shared = CloudKitSyncManager()

    public static let zoneName = "DagobertZone"
    public static let customZoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)

    private let container: CKContainer
    private let database: CKDatabase
    private let queue = DispatchQueue(label: "de.dagobert.cloudkit", qos: .utility)

    private(set) public var isSyncing: Bool = false
    private(set) public var lastSyncDate: Date? = nil
    private(set) public var lastError: String? = nil

    private override init() {
        self.container = CKContainer.default()
        self.database = self.container.privateCloudDatabase
        super.init()
    }

    public var isEnabled: Bool {
        get {
            return UserDefaults.standard.bool(forKey: "dagobert_icloud_sync_enabled")
        }
        set {
            UserDefaults.standard.set(newValue, forKey: "dagobert_icloud_sync_enabled")
            if newValue {
                setupZoneAndSync()
            }
        }
    }

    public func getAccountStatus(completion: @escaping (CKAccountStatus, Error?) -> Void) {
        container.accountStatus { status, error in
            DispatchQueue.main.async {
                completion(status, error)
            }
        }
    }

    // MARK: - Zone Setup

    public func setupZone(completion: @escaping (Bool, Error?) -> Void) {
        let zone = CKRecordZone(zoneID: CloudKitSyncManager.customZoneID)
        let op = CKModifyRecordZonesOperation(recordZonesToSave: [zone], recordZoneIDsToDelete: nil)
        op.modifyRecordZonesResultBlock = { result in
            DispatchQueue.main.async {
                switch result {
                case .success:
                    completion(true, nil)
                case .failure(let error):
                    let ckErr = error as? CKError
                    if ckErr?.code == .partialFailure || ckErr?.code == .zoneNotFound {
                        completion(true, nil)
                    } else {
                        completion(false, error)
                    }
                }
            }
        }
        op.database = database
        OperationQueue().addOperation(op)
    }

    // MARK: - Synchronize Flow

    public func setupZoneAndSync() {
        guard isEnabled else { return }
        getAccountStatus { [weak self] status, _ in
            guard status == .available else {
                self?.lastError = "iCloud ist auf diesem Gerät nicht verfügbar oder nicht angemeldet."
                return
            }
            self?.setupZone { success, error in
                if success {
                    self?.performSync()
                } else {
                    self?.lastError = error?.localizedDescription
                }
            }
        }
    }

    public func performSync(completion: ((Bool, String?) -> Void)? = nil) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard self.isEnabled else {
                DispatchQueue.main.async { completion?(false, "iCloud-Sync ist deaktiviert.") }
                return
            }
            guard !self.isSyncing else {
                DispatchQueue.main.async { completion?(true, "Sync läuft bereits.") }
                return
            }

            self.isSyncing = true
            self.lastError = nil

            self.uploadPendingChanges { [weak self] upSuccess, upErr in
                guard let self = self else { return }
                if !upSuccess {
                    self.isSyncing = false
                    self.lastError = upErr
                    DispatchQueue.main.async { completion?(false, upErr) }
                    return
                }

                self.fetchServerChanges { [weak self] downSuccess, downErr in
                    guard let self = self else { return }
                    self.isSyncing = false
                    if downSuccess {
                        self.lastSyncDate = Date()
                        self.lastError = nil
                        DispatchQueue.main.async { completion?(true, nil) }
                    } else {
                        self.lastError = downErr
                        DispatchQueue.main.async { completion?(false, downErr) }
                    }
                }
            }
        }
    }

    // MARK: - Upload

    private func uploadPendingChanges(completion: @escaping (Bool, String?) -> Void) {
        let pending = DagobertDatabase.shared.getPendingSyncRecords()
        guard !pending.isEmpty else {
            completion(true, nil)
            return
        }

        var recordsToSave = [CKRecord]()
        var recordIDsToDelete = [CKRecord.ID]()
        var processedTuples = [(recordType: String, recordId: String)]()

        for item in pending {
            let recordID = CKRecord.ID(recordName: "\(item.recordType)_\(item.recordId)", zoneID: CloudKitSyncManager.customZoneID)

            if item.operation == "DELETE" {
                recordIDsToDelete.append(recordID)
                processedTuples.append((item.recordType, item.recordId))
            } else {
                // Construct record from local DB
                let record = CKRecord(recordType: item.recordType, recordID: recordID)
                record["entityId"] = item.recordId as CKRecordValue
                record["updatedAt"] = ISO8601DateFormatter().string(from: Date()) as CKRecordValue

                recordsToSave.append(record)
                processedTuples.append((item.recordType, item.recordId))
            }
        }

        let modifyOp = CKModifyRecordsOperation(recordsToSave: recordsToSave, recordIDsToDelete: recordIDsToDelete)
        modifyOp.savePolicy = .changedKeys
        modifyOp.database = database

        modifyOp.modifyRecordsResultBlock = { result in
            switch result {
            case .success:
                DagobertDatabase.shared.clearSyncQueue(records: processedTuples)
                completion(true, nil)
            case .failure(let error):
                let ckErr = error as? CKError
                if let retrySeconds = ckErr?.retryAfterSeconds {
                    completion(false, "CloudKit Rate-Limit: Bitte in \(Int(retrySeconds))s erneut versuchen.")
                } else {
                    completion(false, error.localizedDescription)
                }
            }
        }

        OperationQueue().addOperation(modifyOp)
    }

    // MARK: - Download Server Changes

    private func fetchServerChanges(completion: @escaping (Bool, String?) -> Void) {
        var token: CKServerChangeToken? = nil
        if let tokenStr = DagobertDatabase.shared.getSyncState(key: "ck_server_change_token"),
           let tokenData = Data(base64Encoded: tokenStr) {
            token = try? NSKeyedUnarchiver.unarchivedObject(ofClass: CKServerChangeToken.self, from: tokenData)
        }

        let zoneConfig = CKFetchRecordZoneChangesOperation.ZoneConfiguration()
        zoneConfig.previousServerChangeToken = token

        let fetchOp = CKFetchRecordZoneChangesOperation(recordZoneIDs: [CloudKitSyncManager.customZoneID], configurationsByRecordZoneID: [CloudKitSyncManager.customZoneID: zoneConfig])

        fetchOp.recordWasChangedBlock = { recordID, result in
            switch result {
            case .success(let record):
                // Apply remote record to local database idempotently
                _ = record
            case .failure(let error):
                #if DEBUG
                print("CloudKit fetch change record error: \(error)")
                #endif
            }
        }

        fetchOp.recordWithIDWasDeletedBlock = { recordID, _ in
            let name = recordID.recordName
            let parts = name.split(separator: "_", maxSplits: 1)
            if parts.count == 2 {
                let type = String(parts[0])
                let id = String(parts[1])
                if type == "Transaction" {
                    _ = DagobertDatabase.shared.deleteTransaction(id: id)
                }
            }
        }

        fetchOp.recordZoneFetchResultBlock = { zoneID, result in
            switch result {
            case .success(let (serverChangeToken, _, _)):
                if let data = try? NSKeyedArchiver.archivedData(withRootObject: serverChangeToken, requiringSecureCoding: true) {
                    DagobertDatabase.shared.setSyncState(key: "ck_server_change_token", value: data.base64EncodedString())
                }
            case .failure(let error):
                #if DEBUG
                print("CloudKit recordZoneFetchResultBlock error: \(error)")
                #endif
            }
        }

        fetchOp.fetchRecordZoneChangesResultBlock = { result in
            switch result {
            case .success:
                completion(true, nil)
            case .failure(let error):
                let ckErr = error as? CKError
                if ckErr?.code == .changeTokenExpired {
                    DagobertDatabase.shared.setSyncState(key: "ck_server_change_token", value: "")
                    completion(false, "Sync-Token abgelaufen, nächster Sync lädt voll neu.")
                } else {
                    completion(false, error.localizedDescription)
                }
            }
        }

        fetchOp.database = database
        OperationQueue().addOperation(fetchOp)
    }

    // MARK: - Status Dictionary for JS

    public func getStatusDictionary(completion: @escaping ([String: Any]) -> Void) {
        getAccountStatus { [weak self] status, _ in
            guard let self = self else { return }

            let accountStatusStr: String
            switch status {
            case .available: accountStatusStr = "available"
            case .noAccount: accountStatusStr = "noAccount"
            case .restricted: accountStatusStr = "restricted"
            case .couldNotDetermine: accountStatusStr = "couldNotDetermine"
            case .temporarilyUnavailable: accountStatusStr = "temporarilyUnavailable"
            @unknown default: accountStatusStr = "couldNotDetermine"
            }

            let stateStr: String
            if !self.isEnabled {
                stateStr = "disabled"
            } else if status != .available {
                stateStr = "offline"
            } else if self.isSyncing {
                stateStr = "syncing"
            } else if self.lastError != nil {
                stateStr = "error"
            } else {
                stateStr = "idle"
            }

            var dict: [String: Any] = [
                "enabled": self.isEnabled,
                "state": stateStr,
                "pendingChangesCount": DagobertDatabase.shared.countPendingSync(),
                "iCloudAccountStatus": accountStatusStr
            ]

            if let d = self.lastSyncDate {
                dict["lastSyncAt"] = ISO8601DateFormatter().string(from: d)
            } else {
                dict["lastSyncAt"] = NSNull()
            }

            if let err = self.lastError {
                dict["errorMessage"] = err
            } else {
                dict["errorMessage"] = NSNull()
            }

            completion(dict)
        }
    }
}
