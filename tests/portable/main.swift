import Foundation
import SQLite3

func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw DagobertDatabase.StoreError(message: message) }
}
let arguments = CommandLine.arguments
let mode = arguments[1]
let directory = URL(fileURLWithPath: arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
let defaults: [String: Any] = ["accounts": [], "categories": [], "rules": [], "transactions": [], "bankTemplates": []]
func open(_ name: String) throws -> DagobertDatabase {
    let store = try DagobertDatabase(url: directory.appendingPathComponent(name + ".sqlite"))
    try store.bootstrap(defaults)
    return store
}
func tx(_ amount: Double = -12.34) -> [String: Any] {
    ["date": "2026-11-01", "amount": amount, "currency": "EUR", "payee": "Testladen", "purpose": "Synthetisch",
     "rawText": "Synthetisch", "type": "Bar", "category": "sonstiges", "account": "testkonto", "status": "booked", "sourceHash": "test-hash", "importedAt": "2026-11-01T12:00:00Z"]
}
func migrationFixture(_ name: String, abort: Bool) throws {
    let url = directory.appendingPathComponent(name + ".sqlite")
    // Create the new empty schema, then emulate a never-migrated legacy installation.
    let empty = try DagobertDatabase(url: url)
    try empty.setMetadata("legacyMigrated", nil)
    var connection: OpaquePointer?
    try expect(sqlite3_open(url.path, &connection) == SQLITE_OK, "legacy fixture open")
    defer { sqlite3_close(connection) }
    func execute(_ sql: String) throws { try expect(sqlite3_exec(connection, sql, nil, nil, nil) == SQLITE_OK, "legacy fixture SQL") }
    func scalar(_ sql: String) throws -> String {
        var statement: OpaquePointer?
        try expect(sqlite3_prepare_v2(connection, sql, -1, &statement, nil) == SQLITE_OK, "legacy fixture read")
        defer { sqlite3_finalize(statement) }
        try expect(sqlite3_step(statement) == SQLITE_ROW, "legacy fixture result")
        return String(cString: sqlite3_column_text(statement, 0))
    }
    func snapshot() throws -> String {
        var result = [[String: Any]]()
        for table in ["profiles", "accounts", "categories", "rules", "transactions", "bank_templates"] {
            var statement: OpaquePointer?
            try expect(sqlite3_prepare_v2(connection, "SELECT * FROM \(table) ORDER BY rowid", -1, &statement, nil) == SQLITE_OK, "legacy snapshot")
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                var row: [String: Any] = ["table": table]
                for column in 0..<sqlite3_column_count(statement) {
                    row[String(cString: sqlite3_column_name(statement, column))] = sqlite3_column_type(statement, column) == SQLITE_NULL ? NSNull() : String(cString: sqlite3_column_text(statement, column)) as Any
                }
                result.append(row)
            }
        }
        return try DagobertDatabase.json(result)
    }
    let schema = try String(contentsOfFile: "tests/portable/legacy-schema.sql", encoding: .utf8)
    try execute(schema)
    try execute("""
        INSERT INTO profiles VALUES ('privat','Altbestand','User','#0A84FF','synthetic-legacy-hash',1,'2026-01-01','2026-01-01',NULL);
        INSERT INTO profiles VALUES ('firma','Zweitprofil','User','#112233',NULL,0,'2026-01-01','2026-01-01',NULL);
        INSERT INTO accounts VALUES ('cash','privat','Bargeld',NULL,12345,'2026-01-01',NULL,NULL,'2026-01-01','2026-01-01',NULL);
        INSERT INTO categories VALUES ('food','privat','Essen','Package','#112233','expense',NULL,'2026-01-01','2026-01-01',NULL);
        INSERT INTO rules VALUES ('zero','privat','Nullpriorität',0,'[]','food',0,'2026-01-01','2026-01-01',NULL);
        INSERT INTO bank_templates VALUES ('csv','privat','CSV','','utf-8',';','Datum','{"date":"Datum","rawText":"Text","amount":"Betrag"}','standard','YYYY-MM-DD','2026-01-01','2026-01-01',NULL);
        INSERT INTO transactions VALUES ('old-a',7,'privat','2026-11-01',NULL,-1234,'EUR','Synthetisch','Altbestand','Text','Bar','food',NULL,'Bargeld','booked','legacy-a','2026-11-01',1,'2026-01-01','2026-01-01',NULL);
        INSERT INTO transactions VALUES ('old-b',8,'firma','2026-11-01',NULL,5678,'EUR','Synthetisch','','','Bar','food',NULL,'Bargeld','booked','legacy-b','2026-11-01',0,'2026-01-01','2026-01-01','2026-11-02');
        """)
    if abort { try execute("CREATE TRIGGER fail_legacy BEFORE INSERT ON records WHEN NEW.kind='transactions' BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END") }
    let before = try snapshot()
    if abort {
        do { _ = try DagobertDatabase(url: url); throw DagobertDatabase.StoreError(message: "broken migration accepted") }
        catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "migration abort detected") }
        try expect(try scalar("SELECT count(*) FROM records") == "0", "partial legacy migration committed")
        try expect(try scalar("SELECT count(*) FROM device_profile_pins") == "0", "legacy PIN partly migrated")
        try expect(try scalar("SELECT count(*) FROM store_meta WHERE key='legacyMigrated'") == "0", "failed migration marked complete")
    } else {
        let migrated = try DagobertDatabase(url: url)
        try expect(try migrated.profiles().count == 2, "legacy profiles missing")
        try expect(try migrated.pinHash("privat") == "synthetic-legacy-hash", "legacy PIN lost")
        let account = try migrated.records("privat", "accounts")[0].payload
        try expect(account["initialBalance"] as? Double == 123.45, "legacy cents changed")
        try expect(account["checkpointBalance"] is NSNull, "legacy null checkpoint lost")
        let rule = try migrated.records("privat", "rules")[0].payload
        try expect(rule["priority"] as? Int == 0 && rule["enabled"] as? Bool == false, "legacy rule changed")
        let transaction = try migrated.records("privat", "transactions")[0].payload
        try expect(transaction["amount"] as? Double == -12.34 && transaction["isManual"] as? Bool == true, "legacy transaction changed")
        try expect(transaction["syncId"] as? String == "old-a", "legacy identity lost")
        try expect(try migrated.records("firma", "transactions").isEmpty, "legacy deletion resurrected")
        try expect(try migrated.records("firma", "transactions", includeDeleted: true).count == 1, "legacy tombstone lost")
        let pending = try migrated.pendingCount()
        let reopened = try DagobertDatabase(url: url)
        try expect(try reopened.pendingCount() == pending, "legacy migration repeated")
    }
    try expect(try snapshot() == before, "legacy source tables changed")
}
func run() throws {
if mode == "roundtrip" {
    let bytes = try Data(contentsOf: URL(fileURLWithPath: arguments[3]))
    guard let payload = try JSONSerialization.jsonObject(with: bytes) as? [String: Any], let id = payload["profileId"] as? String else { fatalError("Invalid synthetic fixture") }
    let db = try open("roundtrip")
    _ = try db.importBackup(id, payload, mode: "replace")
    let output = try db.exportBackup(id, all: true)
    try Data(DagobertDatabase.json(output).utf8).write(to: URL(fileURLWithPath: arguments[4]))
    print("NATIVE_ROUNDTRIP_RESULT platform=linux-sqlite appleRuntime=unmeasured")
} else if mode == "verify-conflicts" {
    let bytes = try Data(contentsOf: URL(fileURLWithPath: arguments[3]))
    let payload = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
    let store = try open("conflict-restore")
    _ = try store.importBackup("privat", payload, mode: "replace")
    let restored = try store.conflicts()
    try expect(restored.count == 1, "backup lost active conflicts")
    let conflict = restored[0]
    let recordID = conflict["recordId"] as! String
    try expect(try !store.pending().contains { $0.recordID == recordID }, "restored conflict is not blocked")
    try expect(try DagobertDatabase.json(store.exportBackup("privat", all: false)["syncConflicts"]!) == DagobertDatabase.json(payload["syncConflicts"]!), "backup lost conflict fields")
    let versions = conflict["versions"] as! [[String: Any]]
    let chosen = versions.firstIndex { ($0["data"] as? [String: Any])?["category"] as? String == "lokal" }!
    try store.resolveConflict(conflict["id"] as! String, version: chosen)
    try expect(try store.record(recordID)?.payload["category"] as? String == "lokal", "restored conflict cannot be resolved")
    try expect(try store.conflicts().isEmpty, "restored conflict resolution remains active")
    print("NATIVE_CONFLICT_RESTORE_RESULT passed")
} else {
    var cases = [String: Bool]()
    let a = try open("device-a"), b = try open("device-b")
    let saved = try a.saveEntity("privat", "transactions", tx())
    let id = saved["id"] as! String
    let first = try a.records("privat", "transactions")[0]
    try expect(try DagobertDatabase.cents(saved["amount"]) == -1234, "cents")
    do { _ = try a.saveEntity("privat", "transactions", tx(1.005)); throw DagobertDatabase.StoreError(message: "fractional cents accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "fractional cents rejected") }
    cases["native_precise_money"] = true

    let money = try open("money")
    let noisy = try money.saveEntity("privat", "transactions", tx(0.1 + 0.2))
    try expect(noisy["amount"] as? Double == 0.3, "binary noise leaked into transaction payload")
    _ = try money.saveEntity("privat", "accounts", ["id": "cash", "name": "Cash", "initialBalance": 0.1 + 0.2, "initialBalanceDate": "2026-01-01", "checkpointBalance": NSNull()])
    _ = try money.saveEntity("privat", "categories", ["id": "noise", "budget": 0.1 + 0.2])
    try expect(try money.records("privat", "accounts")[0].payload["initialBalance"] as? Double == 0.3, "binary noise leaked into balance")
    try expect(try money.records("privat", "categories")[0].payload["budget"] as? Double == 0.3, "binary noise leaked into budget")
    cases["native_canonical_money_payloads"] = true
    let validationStore = try open("remote-validation")
    var mismatched = first.envelope
    var mismatchedData = saved; mismatchedData["id"] = "foreign-id"; mismatched["data"] = mismatchedData
    do { try validationStore.applyRemote(mismatched, recordID: first.recordID, systemFields: Data()); throw DagobertDatabase.StoreError(message: "mismatched identity accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "remote identity validated") }
    try expect(try validationStore.records("privat", "transactions").isEmpty, "invalid remote partly stored")
    cases["native_remote_identity_mismatch_rejected"] = true

    let fields = Data("synthetic-system-fields".utf8)
    try b.applyRemote(first.envelope, recordID: first.recordID, systemFields: fields)
    try a.acknowledge(first.recordID, changeID: first.changeID, systemFields: fields, sentEnvelope: first.envelope)
    try a.editTransaction(id, ["category": "lokal"])
    // A stale acknowledgement must not clear the new local edit from the outbox.
    try a.acknowledge(first.recordID, changeID: first.changeID, systemFields: fields, sentEnvelope: first.envelope)
    try expect(try a.pending().contains(where: { $0.recordID == first.recordID }), "stale ack lost local edit")
    cases["native_outbox_ack_revision"] = true

    try b.editTransaction(id, ["category": "remote"])
    let remote = try b.record(first.recordID)!
    try a.applyRemote(remote.envelope, recordID: remote.recordID, systemFields: fields)
    let conflicts = try a.conflicts()
    try expect(conflicts.count == 1, "concurrent edits not retained")
    try expect((conflicts[0]["versions"] as? [[String: Any]])?.count == 2, "missing conflict version")
    try expect(try !a.pending().contains(where: { $0.recordID == first.recordID }), "conflicted record uploaded")
    cases["native_conflict_retains_versions"] = true
    let backup = try a.exportBackup("privat", all: false)
    try Data(DagobertDatabase.json(backup).utf8).write(to: directory.appendingPathComponent("conflict-backup.json"))
    let restoredStore = try open("conflict-backup")
    _ = try restoredStore.importBackup("privat", backup, mode: "replace")
    try expect(try restoredStore.conflicts().count == 1, "backup did not restore active conflict")
    try expect(try !restoredStore.pending().contains { $0.recordID == first.recordID }, "backup unblocked conflicted transaction")
    let restoredConflict = try restoredStore.conflicts()[0]
    try restoredStore.resolveConflict(restoredConflict["id"] as! String, version: 0)
    try expect(try restoredStore.conflicts().isEmpty, "restored conflict cannot be resolved")
    cases["native_backup_restores_active_conflicts"] = true
    let conflictClone = try restoredStore.importBackup("privat", backup, mode: "new_profile")[0]
    let clonedConflict = try restoredStore.conflicts()[0]
    let clonedVersions = clonedConflict["versions"] as! [[String: Any]]
    try expect(clonedConflict["id"] as? String != conflicts[0]["id"] as? String, "cloned conflict identity collides")
    try expect(clonedVersions.allSatisfy { $0["profileId"] as? String == conflictClone }, "cloned conflict points to original profile")
    try restoredStore.resolveConflict(clonedConflict["id"] as! String, version: 0)
    try expect(try restoredStore.conflicts().isEmpty, "cloned conflict cannot be resolved")
    cases["native_conflict_clone_isolation"] = true

    let reject = try open("conflict-invalid")
    let rejectBefore = try DagobertDatabase.json(reject.exportBackup("privat", all: true))
    var invalidBackup = backup, invalidConflict = conflicts[0]
    var invalidVersions = invalidConflict["versions"] as! [[String: Any]]
    invalidVersions[0]["profileId"] = "foreign-profile"; invalidConflict["versions"] = invalidVersions
    invalidBackup["syncConflicts"] = [invalidConflict]
    do { _ = try reject.importBackup("privat", invalidBackup, mode: "replace"); throw DagobertDatabase.StoreError(message: "foreign conflict accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "foreign conflict rejected") }
    // Export time is volatile; the actual records and PIN metadata must remain unchanged.
    let rejectAfter = try reject.exportBackup("privat", all: true)
    let beforeObject = try JSONSerialization.jsonObject(with: Data(rejectBefore.utf8)) as! [String: Any]
    try expect(try DagobertDatabase.json(rejectAfter["transactions"]!) == DagobertDatabase.json(beforeObject["transactions"]!), "invalid conflict partly imported")
    try expect(try reject.conflicts().isEmpty, "invalid conflict became active")
    cases["native_invalid_conflict_atomic_rollback"] = true
    let conflictRecord = try a.records("privat", "conflicts")[0]
    try b.applyRemote(conflictRecord.envelope, recordID: conflictRecord.recordID, systemFields: fields)
    let versions = conflicts[0]["versions"] as! [[String: Any]]
    let chosen = versions.firstIndex { ($0["data"] as? [String: Any])?["category"] as? String == "lokal" }!
    try a.resolveConflict(conflictRecord.id, version: chosen)
    let resolved = try a.record(first.recordID)!
    try b.applyRemote(resolved.envelope, recordID: resolved.recordID, systemFields: fields)
    let conflictDeleted = try a.record(conflictRecord.recordID)!
    try b.applyRemote(conflictDeleted.envelope, recordID: conflictRecord.recordID, systemFields: fields)
    try expect(try b.record(first.recordID)?.payload["category"] as? String == "lokal", "resolution did not converge")
    try expect(try b.conflicts().isEmpty, "resolved conflict remains")
    cases["native_conflict_resolution_converges"] = true

    try a.deleteEntity("privat", "transactions", id)
    let deleted = try a.record(first.recordID)!
    // Acknowledged remote copy can apply a deletion without enqueuing it back.
    let bCurrent = try b.record(first.recordID)!
    try b.acknowledge(first.recordID, changeID: bCurrent.changeID, systemFields: fields, sentEnvelope: bCurrent.envelope)
    try b.applyRemote(deleted.envelope, recordID: deleted.recordID, systemFields: fields)
    try b.applyRemote(deleted.envelope, recordID: deleted.recordID, systemFields: fields)
    try expect(try b.records("privat", "transactions").isEmpty, "tombstone resurrected")
    cases["native_tombstone_idempotent"] = true

    let importer = try open("import")
    var payload: [String: Any] = ["format": "dagobert_backup", "schemaVersion": 2, "profileId": "privat", "profileName": "Test",
        "profile": ["id": "privat", "name": "Test", "icon": "User", "color": "#0A84FF", "isDefault": true],
        "accounts": [], "categories": [], "rules": [], "bankTemplates": [], "transactions": [saved], "additionalProfiles": []]
    _ = try importer.importBackup("privat", payload, mode: "replace")
    let before = try importer.records().map { try DagobertDatabase.json($0.envelope) }
    _ = try importer.importBackup("privat", payload, mode: "merge")
    try expect(try before == importer.records().map { try DagobertDatabase.json($0.envelope) }, "reimport not idempotent")
    cases["native_reimport_idempotent"] = true
    let apiStore = try open("api-append")
    var csv = tx(); csv["status"] = "pending"; csv["category"] = "eigene-kategorie"; csv["sourceHash"] = "tx_csv_original"
    _ = try apiStore.batchImport("privat", [csv], nil)
    let originalCSV = try apiStore.records("privat", "transactions")[0]
    let csvEnvelope = try DagobertDatabase.json(originalCSV.envelope)
    var api = csv; api["status"] = "booked"; api["category"] = "sonstiges"; api["sourceHash"] = "comdirect_api_[\"bank-1\",\"reference-1\"]"
    do { _ = try apiStore.batchImport("privat", [api], nil, appendOnly: true); throw DagobertDatabase.StoreError(message: "unreviewed overlap accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "unreviewed overlap rejected") }
    let addedAPI = try apiStore.batchImport("privat", [api, api], nil, appendOnly: true, reviewedHashes: [api["sourceHash"] as! String])
    try expect(addedAPI["inserted"] == 1 && addedAPI["updated"] == 0 && addedAPI["duplicates"] == 1, "API append promoted CSV or duplicated bank reference")
    try expect(try apiStore.record(originalCSV.recordID).map { try DagobertDatabase.json($0.envelope) } == csvEnvelope, "API append changed existing CSV")
    let repeatedAPI = try apiStore.batchImport("privat", [api], nil, appendOnly: true)
    try expect(repeatedAPI["inserted"] == 0 && repeatedAPI["duplicates"] == 1, "repeated bank reference imported again")
    let beforeInvalidAPI = try apiStore.records().map { try DagobertDatabase.json($0.envelope) }
    var newAPI = api; newAPI["sourceHash"] = "comdirect_api_[\"bank-1\",\"reference-2\"]"
    var badAPI = api; badAPI["date"] = "2026-02-31"; badAPI["sourceHash"] = "comdirect_api_[\"bank-1\",\"reference-3\"]"
    do { _ = try apiStore.batchImport("privat", [newAPI, badAPI], nil, appendOnly: true, reviewedHashes: [newAPI["sourceHash"] as! String, badAPI["sourceHash"] as! String]); throw DagobertDatabase.StoreError(message: "invalid API batch accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "invalid API batch rejected") }
    try expect(try beforeInvalidAPI == apiStore.records().map { try DagobertDatabase.json($0.envelope) }, "invalid API batch partly imported")
    cases["native_api_append_preserves_csv_and_references"] = true
    let ruleStore = try open("rules-only")
    _ = try ruleStore.saveEntity("privat", "transactions", tx())
    let beforeRulesTransactions = try ruleStore.records("privat", "transactions").map { try DagobertDatabase.json($0.envelope) }
    let customCategory: [String: Any] = ["id": "custom", "name": "Eigene Kategorie", "icon": "Tag", "color": "#123456", "type": "expense"]
    let customRule: [String: Any] = ["id": "custom-rule", "name": "Eigene Regel", "priority": 5, "enabled": false, "applyCategory": "custom",
        "conditions": [["field": "payee", "operator": "contains", "value": "Test"]]]
    let importedRules = try ruleStore.importRulesPackage("privat", categories: [customCategory], rules: [customRule], expectedCategories: [], expectedRules: [])
    try expect(importedRules["categoriesAdded"] == 1 && importedRules["rulesAdded"] == 1, "rules-only definitions missing")
    try expect(try beforeRulesTransactions == ruleStore.records("privat", "transactions").map { try DagobertDatabase.json($0.envelope) }, "rules-only import changed transactions")
    cases["native_rules_only_preserves_transactions"] = true
    let allRulesBefore = try ruleStore.records().map { try DagobertDatabase.json($0.envelope) }
    var badRule = customRule; badRule["id"] = "bad-rule"; badRule["applyCategory"] = "new-category"; badRule["conditions"] = [["field": "invalid", "operator": "contains", "value": "Test"]]
    var newCategory = customCategory; newCategory["id"] = "new-category"
    do { _ = try ruleStore.importRulesPackage("privat", categories: [newCategory], rules: [badRule], expectedCategories: [customCategory], expectedRules: [customRule]); throw DagobertDatabase.StoreError(message: "invalid rules accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "invalid rules rejected") }
    try expect(try allRulesBefore == ruleStore.records().map { try DagobertDatabase.json($0.envelope) }, "rules import partly committed")
    do { _ = try ruleStore.importRulesPackage("privat", categories: [newCategory], rules: [], expectedCategories: [], expectedRules: []); throw DagobertDatabase.StoreError(message: "stale rules snapshot accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "stale rules snapshot rejected") }
    cases["native_rules_import_atomic_and_stale_safe"] = true
    try ruleStore.updateProfile("privat", ["name": " Neuer Profilname "])
    let renamedProfile = try ruleStore.profileData("privat")["profile"] as! [String: Any]
    try expect(renamedProfile["id"] as? String == "privat" && renamedProfile["name"] as? String == "Neuer Profilname", "rename changed profile identity")
    try expect(try beforeRulesTransactions == ruleStore.records("privat", "transactions").map { try DagobertDatabase.json($0.envelope) }, "rename changed transactions")
    cases["native_profile_rename_keeps_identity"] = true
    let clones = try importer.importBackup("privat", payload, mode: "new_profile")
    let originalTx = try importer.records("privat", "transactions")[0]
    let cloneTx = try importer.records(clones[0], "transactions")[0]
    try expect(originalTx.id != cloneTx.id, "cloned transaction has ambiguous local id")
    try importer.editTransaction(cloneTx.id, ["purpose": "Nur Klon"])
    try expect(try importer.record(originalTx.recordID)?.payload["purpose"] as? String == "Synthetisch", "cross-profile edit")
    cases["native_profile_identity_isolation"] = true
    var collision = payload, additional = payload
    additional["profileId"] = clones[0]; additional["profileName"] = "Klon"
    additional.removeValue(forKey: "additionalProfiles"); collision["additionalProfiles"] = [additional]
    let collisionBefore = try importer.records(nil, nil, includeDeleted: true).map { try DagobertDatabase.json($0.envelope) }
    do { _ = try importer.importBackup(clones[0], collision, mode: "replace"); throw DagobertDatabase.StoreError(message: "profile collision accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "profile collision rejected") }
    try expect(try collisionBefore == importer.records(nil, nil, includeDeleted: true).map { try DagobertDatabase.json($0.envelope) }, "profile collision partly imported")
    cases["native_multi_profile_collision_atomic"] = true

    var connection: OpaquePointer?
    try expect(sqlite3_open(directory.appendingPathComponent("import.sqlite").path, &connection) == SQLITE_OK, "probe connection")
    defer { sqlite3_close(connection) }
    let trigger = "CREATE TRIGGER fail_import BEFORE INSERT ON records WHEN NEW.kind='transactions' AND json_extract(NEW.payload,'purpose')='ABORT_TEST' BEGIN SELECT RAISE(ABORT,'synthetic'); END"
    try expect(sqlite3_exec(connection, trigger, nil, nil, nil) == SQLITE_OK, "trigger setup")
    let fullBefore = try importer.records(nil, nil, includeDeleted: true).map { try DagobertDatabase.json($0.envelope) }
    var broken = saved; broken["purpose"] = "ABORT_TEST"
    payload["transactions"] = [broken]
    do { _ = try importer.importBackup("privat", payload, mode: "replace"); throw DagobertDatabase.StoreError(message: "failed import accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "injected failure detected") }
    try expect(try fullBefore == importer.records(nil, nil, includeDeleted: true).map { try DagobertDatabase.json($0.envelope) }, "partial failed import")
    cases["native_import_atomic_rollback"] = true

    let restart = try DagobertDatabase(url: directory.appendingPathComponent("device-a.sqlite"))
    try expect(try restart.pendingCount() == a.pendingCount(), "outbox lost on restart")
    try expect(try restart.record(first.recordID)?.deletedAt != nil, "deletion lost on restart")
    cases["native_restart_persists_outbox"] = true
    try migrationFixture("legacy-valid", abort: false)
    cases["native_legacy_migration_preserves_source"] = true
    try migrationFixture("legacy-abort", abort: true)
    cases["native_legacy_migration_atomic_rollback"] = true
    let inboxDirectory = directory.appendingPathComponent("inbox", isDirectory: true)
    let inbox = try DocumentInbox(directory: inboxDirectory, maximumBytes: 64)
    let source = directory.appendingPathComponent("Überweisung.json")
    let originalBytes = Data("{\"synthetic\":true}".utf8)
    try originalBytes.write(to: source)
    let staged = try inbox.stage(source)
    try expect(try inbox.pending().count == 1, "incoming document lost")
    try expect(try inbox.read(staged.id)["base64"] as? String == originalBytes.base64EncodedString(), "incoming file bytes changed")
    try Data("changed outside app".utf8).write(to: source)
    let reopenedInbox = try DocumentInbox(directory: inboxDirectory, maximumBytes: 64)
    try expect(try reopenedInbox.read(staged.id)["base64"] as? String == originalBytes.base64EncodedString(), "staged file depends on external source")
    try inbox.acknowledge(staged.id)
    try expect(try reopenedInbox.pending().isEmpty, "consumed incoming document offered again")
    try expect(FileManager.default.fileExists(atPath: inboxDirectory.appendingPathComponent(staged.id + ".json").path), "source copy removed during acknowledgment")
    cases["native_document_inbox_restart_and_bytes"] = true
    let tooLarge = directory.appendingPathComponent("large.csv")
    try Data(repeating: 65, count: 65).write(to: tooLarge)
    for invalid in [tooLarge, directory.appendingPathComponent("file.sqlite")] {
        do { _ = try inbox.stage(invalid); throw DagobertDatabase.StoreError(message: "invalid incoming file accepted") }
        catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "unsafe incoming file rejected") }
    }
    do { _ = try inbox.read("../Überweisung.json"); throw DagobertDatabase.StoreError(message: "unsafe incoming id accepted") }
    catch let error as DagobertDatabase.StoreError { try expect(!error.message.contains("accepted"), "unsafe incoming id rejected") }
    try expect(try inbox.pending().isEmpty, "failed incoming document partly staged")
    cases["native_document_inbox_rejects_unsafe_input"] = true
    let vectorsURL = directory.appendingPathComponent("identity-vectors.json")
    if FileManager.default.fileExists(atPath: vectorsURL.path) {
        let vectors = try JSONSerialization.jsonObject(with: Data(contentsOf: vectorsURL)) as! [[String: String]]
        for vector in vectors { try expect(DagobertDatabase.stableIdentity(vector["namespace"]!, vector["value"]!) == vector["expected"]!, "cross-language identity mismatch") }
        cases["native_identity_matches_typescript"] = true
    }
    let report: [String: Any] = ["version": 1, "checks": cases.count, "failures": 0, "cases": cases,
        "scope": "Production Swift store on host SQLite; iOS frameworks and CloudKit transport unmeasured"]
    try Data(DagobertDatabase.json(report).utf8).write(to: directory.appendingPathComponent("native-result.json"))
    print("NATIVE_STORE_RESULT checks=\(cases.count) failures=0 appleRuntime=unmeasured")
}
}
do { try run() }
catch {
    FileHandle.standardError.write(Data("NATIVE_STORE_ERROR \(error.localizedDescription)\n".utf8))
    exit(1)
}
