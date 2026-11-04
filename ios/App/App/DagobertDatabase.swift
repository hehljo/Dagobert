import Foundation
import CoreFoundation
import SQLite3

// JSON dictionaries are confined to the bridge, backup, and CloudKit payload boundary.
// SQLite owns every authoritative record; there is no IndexedDB mirror.
public final class DagobertDatabase: @unchecked Sendable {
    public struct StoreError: LocalizedError {
        let message: String
        public var errorDescription: String? { message }
    }
    public struct SyncRecord {
        let recordID: String
        let profileID: String
        let kind: String
        let id: String
        let payload: [String: Any]
        let revision: Int64
        let changeID: String
        let deletedAt: String?
        let systemFields: Data?
        let resolves: [String]
        var envelope: [String: Any] {
            var result: [String: Any] = ["schemaVersion": 2, "profileId": profileID, "kind": kind,
                "id": id, "data": payload, "revision": revision, "changeId": changeID, "resolves": resolves]
            if let deletedAt { result["deletedAt"] = deletedAt }
            return result
        }
    }
    private final class SharedHolder: @unchecked Sendable {
        let lock = NSLock()
        var store: DagobertDatabase?
    }
    private static let holder = SharedHolder()
    public static func sharedStore() throws -> DagobertDatabase {
        holder.lock.lock(); defer { holder.lock.unlock() }
        if let store = holder.store { return store }
        let fm = FileManager.default
        let parent = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Dagobert", isDirectory: true)
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        #if os(iOS)
        try fm.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: parent.path)
        #endif
        let store = try DagobertDatabase(url: parent.appendingPathComponent("dagobert_local.sqlite"))
        holder.store = store
        return store
    }
    private var db: OpaquePointer?
    private let lock = NSRecursiveLock()
    private var depth = 0
    public static let kinds = ["accounts", "categories", "rules", "transactions", "bankTemplates"]
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    public init(url: URL) throws {
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            if let db { sqlite3_close(db) }
            db = nil
            throw StoreError(message: "Die lokale Datenbank konnte nicht geöffnet werden. Deine Daten bleiben erhalten.")
        }
        do {
            sqlite3_busy_timeout(db, 5000)
            try execute("PRAGMA journal_mode = WAL")
            try execute("PRAGMA foreign_keys = ON")
            try execute("PRAGMA synchronous = FULL")
            try execute("CREATE TABLE IF NOT EXISTS store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS record_scopes (id TEXT PRIMARY KEY)")
            try execute("""
                CREATE TABLE IF NOT EXISTS records (
                    profile_id TEXT NOT NULL REFERENCES record_scopes(id), kind TEXT NOT NULL, id TEXT NOT NULL,
                    record_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL CHECK(json_valid(payload)),
                    amount_cents INTEGER, revision INTEGER NOT NULL, change_id TEXT NOT NULL, deleted_at TEXT,
                    dirty INTEGER NOT NULL DEFAULT 1 CHECK(dirty IN (0,1)), seeded INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
                    system_fields BLOB, base_payload TEXT, resolves TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(profile_id, kind, id)
                )
                """)
            try execute("CREATE INDEX IF NOT EXISTS records_pending ON records(dirty, blocked)")
            try execute("CREATE TABLE IF NOT EXISTS device_profile_pins (profile_id TEXT PRIMARY KEY, hash TEXT NOT NULL)")
            try migrateLegacy()
            #if os(iOS)
            for path in [url.path, url.path + "-wal", url.path + "-shm"] where FileManager.default.fileExists(atPath: path) {
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: path)
            }
            #endif
        } catch {
            sqlite3_close(db)
            db = nil
            throw error
        }
    }
    deinit { if let db { sqlite3_close(db) } }

    // All SQL parameters are bound. Errors contain no statement, parameter, or bank data.
    private func statement(_ sql: String, _ values: [Any?] = []) throws -> OpaquePointer {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw StoreError(message: "Datenbankabfrage fehlgeschlagen. Es wurden keine Daten übernommen.")
        }
        do {
            for (offset, value) in values.enumerated() {
                let index = Int32(offset + 1)
                let code: Int32
                switch value {
                case nil, is NSNull: code = sqlite3_bind_null(stmt, index)
                case let value as Data:
                    code = value.withUnsafeBytes { sqlite3_bind_blob(stmt, index, $0.baseAddress, Int32(value.count), Self.transient) }
                case let value as String: code = sqlite3_bind_text(stmt, index, value, -1, Self.transient)
                case let value as Int64: code = sqlite3_bind_int64(stmt, index, value)
                case let value as Int: code = sqlite3_bind_int64(stmt, index, Int64(value))
                case let value as Double: code = sqlite3_bind_double(stmt, index, value)
                default: throw StoreError(message: "Nicht unterstützter Datenbankwert.")
                }
                guard code == SQLITE_OK else { throw StoreError(message: "Datenbankwert konnte nicht gespeichert werden.") }
            }
        } catch { sqlite3_finalize(stmt); throw error }
        return stmt
    }
    @discardableResult private func execute(_ sql: String, _ values: [Any?] = []) throws -> Int {
        let stmt = try statement(sql, values)
        defer { sqlite3_finalize(stmt) }
        var code = sqlite3_step(stmt)
        while code == SQLITE_ROW { code = sqlite3_step(stmt) }
        guard code == SQLITE_DONE else { throw StoreError(message: "Speichern fehlgeschlagen. Der Vorgang wurde zurückgerollt.") }
        return Int(sqlite3_changes(db))
    }
    private func rows(_ sql: String, _ values: [Any?] = []) throws -> [[String: Any]] {
        let stmt = try statement(sql, values)
        defer { sqlite3_finalize(stmt) }
        var result = [[String: Any]]()
        var code = sqlite3_step(stmt)
        while code == SQLITE_ROW {
            var row = [String: Any]()
            for column in 0..<sqlite3_column_count(stmt) {
                let name = String(cString: sqlite3_column_name(stmt, column))
                switch sqlite3_column_type(stmt, column) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(stmt, column)
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, column)
                case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, column))
                case SQLITE_BLOB:
                    if let pointer = sqlite3_column_blob(stmt, column) { row[name] = Data(bytes: pointer, count: Int(sqlite3_column_bytes(stmt, column))) }
                default: row[name] = NSNull()
                }
            }
            result.append(row)
            code = sqlite3_step(stmt)
        }
        guard code == SQLITE_DONE else { throw StoreError(message: "Lesen der lokalen Daten fehlgeschlagen.") }
        return result
    }
    public func transaction<T>(_ body: () throws -> T) throws -> T {
        lock.lock(); defer { lock.unlock() }
        if depth > 0 { return try body() }
        try execute("BEGIN IMMEDIATE")
        depth += 1
        defer { depth -= 1 }
        do { let value = try body(); try execute("COMMIT"); return value }
        catch {
            let original = error
            do { try execute("ROLLBACK") }
            catch { throw StoreError(message: "Datenbank konnte nicht sicher zurückgerollt werden. Bitte die App neu starten.") }
            throw original
        }
    }
    public func metadata(_ key: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return try rows("SELECT value FROM store_meta WHERE key = ?", [key]).first?["value"] as? String
    }
    public func setMetadata(_ key: String, _ value: String?) throws {
        try transaction {
            if try metadata(key) == value { return }
            if let value { try execute("INSERT INTO store_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]) }
            else { try execute("DELETE FROM store_meta WHERE key = ?", [key]) }
        }
    }
    public static func json(_ value: Any) throws -> String {
        guard JSONSerialization.isValidJSONObject(value), let text = String(data: try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]), encoding: .utf8) else {
            throw StoreError(message: "Ungültige JSON-Daten.")
        }
        return text
    }
    private static func object(_ text: String) throws -> [String: Any] {
        guard let data = text.data(using: .utf8), let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw StoreError(message: "Gespeicherte Daten sind ungültig. Bitte ein Backup verwenden.")
        }
        return object
    }
    public static func stableIdentity(_ namespace: String, _ value: String) -> String {
        var high: UInt64 = 0x6c62272e07bb0142, low: UInt64 = 0x62b821756295c58d
        for byte in "\(namespace.utf16.count):\(namespace)\(value)".utf8 {
            low ^= UInt64(byte)
            let product = low.multipliedFullWidth(by: 315)
            high = (high &* 315) &+ product.high &+ (low << 24)
            low = product.low
        }
        var hex = Array(String(format: "%016llx%016llx", high, low))
        hex[12] = "8"
        let nibble = Int(String(hex[16]), radix: 16) ?? 0
        hex[16] = Character(String((nibble & 3) | 8, radix: 16))
        return [String(hex[0..<8]), String(hex[8..<12]), String(hex[12..<16]), String(hex[16..<20]), String(hex[20..<32])].joined(separator: "-")
    }
    public static func cents(_ value: Any?) throws -> Int64 {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            throw StoreError(message: "Ungültiger Geldbetrag.")
        }
        let scaled = number.doubleValue * 100
        let rounded = scaled.rounded()
        guard scaled.isFinite, abs(scaled - rounded) <= 0.000001, abs(rounded) <= 9_007_199_254_740_991 else {
            throw StoreError(message: "Geldbetrag ist nicht als ganzer Centbetrag darstellbar.")
        }
        return Int64(rounded)
    }
    private static func canonicalMoney(_ kind: String, _ data: [String: Any]) throws -> [String: Any] {
        var result = data
        let fields = kind == "transactions" ? ["amount"] : kind == "accounts" ? ["initialBalance", "checkpointBalance"] : kind == "categories" ? ["budget"] : []
        for field in fields {
            if let value = result[field], !(value is NSNull) { result[field] = Double(try cents(value)) / 100 }
        }
        return result
    }
    private func decode(_ row: [String: Any]) throws -> SyncRecord {
        guard let recordID = row["record_id"] as? String, let profileID = row["profile_id"] as? String,
              let kind = row["kind"] as? String, let id = row["id"] as? String, let text = row["payload"] as? String,
              let revision = row["revision"] as? Int64, let change = row["change_id"] as? String else {
            throw StoreError(message: "Unvollständiger Datenbankeintrag.")
        }
        return try SyncRecord(recordID: recordID, profileID: profileID, kind: kind, id: id, payload: Self.object(text),
            revision: revision, changeID: change, deletedAt: row["deleted_at"] as? String, systemFields: row["system_fields"] as? Data,
            resolves: try JSONSerialization.jsonObject(with: Data((row["resolves"] as? String ?? "[]").utf8)) as? [String] ?? [])
    }
    private func find(_ profile: String, _ kind: String, _ id: String) throws -> SyncRecord? {
        try rows("SELECT * FROM records WHERE profile_id=? AND kind=? AND id=?", [profile, kind, id]).first.map(decode)
    }
    public func record(_ recordID: String) throws -> SyncRecord? {
        lock.lock(); defer { lock.unlock() }
        return try rows("SELECT * FROM records WHERE record_id=?", [recordID]).first.map(decode)
    }
    public func records(_ profile: String? = nil, _ kind: String? = nil, includeDeleted: Bool = false) throws -> [SyncRecord] {
        lock.lock(); defer { lock.unlock() }
        var clauses = [String](), values = [Any?]()
        if let profile { clauses.append("profile_id=?"); values.append(profile) }
        if let kind { clauses.append("kind=?"); values.append(kind) }
        if !includeDeleted { clauses.append("deleted_at IS NULL") }
        return try rows("SELECT * FROM records" + (clauses.isEmpty ? "" : " WHERE " + clauses.joined(separator: " AND ")) + " ORDER BY kind,id", values).map(decode)
    }
    private func put(_ profile: String, _ kind: String, _ id: String, _ data: [String: Any], deletedAt: String? = nil, seeded: Bool = false) throws {
        let data = try Self.canonicalMoney(kind, data)
        let old = try find(profile, kind, id)
        let text = try Self.json(data)
        if let old, try Self.json(old.payload) == text && old.deletedAt == deletedAt { return }
        let amount = kind == "transactions" ? try Self.cents(data["amount"]) : nil
        try execute("INSERT OR IGNORE INTO record_scopes(id) VALUES (?)", [profile])
        try execute("""
            INSERT INTO records(profile_id,kind,id,record_id,payload,amount_cents,revision,change_id,deleted_at,dirty,seeded)
            VALUES (?,?,?,?,?,?,?,?,?,1,?)
            ON CONFLICT(profile_id,kind,id) DO UPDATE SET payload=excluded.payload,amount_cents=excluded.amount_cents,
            revision=excluded.revision,change_id=excluded.change_id,deleted_at=excluded.deleted_at,dirty=1,seeded=excluded.seeded
            """, [profile, kind, id, old?.recordID ?? Self.stableIdentity("record:\(profile):\(kind)", id), text,
                    amount, (old?.revision ?? 0) + 1, UUID().uuidString.lowercased(), deletedAt, seeded ? 1 : 0])
    }
    public func requireProfile(_ id: String) throws {
        guard let profile = try find(id, "profiles", id), profile.deletedAt == nil else { throw StoreError(message: "Profil nicht gefunden.") }
    }
    public func bootstrap(_ defaults: [String: Any]) throws {
        try transaction {
            try setMetadata("defaults", Self.json(defaults))
            if try records(nil, "profiles").isEmpty {
                try put("privat", "profiles", "privat", ["id": "privat", "name": "Privat", "icon": "User", "color": "#0A84FF", "isDefault": true, "createdAt": Self.now()], seeded: true)
                try seed("privat")
            }
        }
    }
    private func seed(_ profile: String) throws {
        guard let text = try metadata("defaults") else { throw StoreError(message: "Die App-Vorlagen fehlen. Bitte Dagobert neu öffnen.") }
        let defaults = try Self.object(text)
        for kind in Self.kinds {
            for row in defaults[kind] as? [[String: Any]] ?? [] {
                guard let id = row["id"] as? String else { throw StoreError(message: "Ungültige App-Vorlage.") }
                try put(profile, kind, id, row, seeded: true)
            }
        }
    }
    public static func now() -> String { ISO8601DateFormatter().string(from: Date()) }
    public func profiles() throws -> [[String: Any]] {
        try records(nil, "profiles").map { record in
            var p = record.payload; p["hasPin"] = try pinHash(record.profileID) != nil; return p
        }.sorted { (($0["isDefault"] as? Bool) == true ? 0 : 1, $0["name"] as? String ?? "") < (($1["isDefault"] as? Bool) == true ? 0 : 1, $1["name"] as? String ?? "") }
    }
    public func recoveryBackups() throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return try rows("SELECT key,value FROM store_meta WHERE key LIKE 'recovery:%' ORDER BY key").map { row in
            let payload = try Self.object(row["value"] as? String ?? "{}")
            return ["id": row["key"] ?? "", "exportedAt": payload["exportedAt"] ?? "", "profileName": payload["profileName"] ?? ""]
        }
    }
    public func pinHash(_ id: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return try rows("SELECT hash FROM device_profile_pins WHERE profile_id=?", [id]).first?["hash"] as? String
    }
    public func setPinHash(_ id: String, _ hash: String?) throws {
        _ = try transaction {
            if let hash { try execute("INSERT INTO device_profile_pins(profile_id,hash) VALUES (?,?) ON CONFLICT(profile_id) DO UPDATE SET hash=excluded.hash", [id, hash]) }
            else { try execute("DELETE FROM device_profile_pins WHERE profile_id=?", [id]) }
        }
    }
    public func createProfile(_ name: String, icon: String, color: String, pinHash: String?) throws -> [String: Any] {
        try transaction {
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw StoreError(message: "Bitte einen Profilnamen eingeben.") }
            let id = UUID().uuidString.lowercased()
            let p: [String: Any] = ["id": id, "name": name, "icon": icon, "color": color, "isDefault": false, "createdAt": Self.now()]
            try put(id, "profiles", id, p); try seed(id); try setPinHash(id, pinHash)
            return p.merging(["hasPin": pinHash != nil]) { _, new in new }
        }
    }
    public func updateProfile(_ id: String, _ changes: [String: Any]) throws {
        try transaction {
            try requireProfile(id)
            var payload = try find(id, "profiles", id)!.payload
            for key in ["name", "icon", "color"] { if let value = changes[key] as? String { payload[key] = key == "name" ? value.trimmingCharacters(in: .whitespacesAndNewlines) : value } }
            if (payload["name"] as? String ?? "").count > 100 { throw StoreError(message: "Der Profilname darf höchstens 100 Zeichen enthalten.") }
            if (payload["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw StoreError(message: "Bitte einen Profilnamen eingeben.") }
            try put(id, "profiles", id, payload)
        }
    }
    public func deleteProfile(_ id: String) throws {
        try transaction {
            guard try profiles().count > 1 else { throw StoreError(message: "Das letzte Profil kann nicht gelöscht werden.") }
            for record in try records(id) { try put(id, record.kind, record.id, record.payload, deletedAt: Self.now()) }
            try setPinHash(id, nil)
        }
    }
    public func profileData(_ id: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        try requireProfile(id)
        var profile = try find(id, "profiles", id)!.payload
        profile["hasPin"] = try pinHash(id) != nil
        var result: [String: Any] = ["profile": profile]
        for kind in Self.kinds { result[kind] = try records(id, kind).map(\.payload) }
        return result
    }
    public func transactionProfile(_ id: String) throws -> String {
        lock.lock(); defer { lock.unlock() }
        guard let record = try rows("SELECT * FROM records WHERE kind='transactions' AND id=? AND deleted_at IS NULL", [id]).first else { throw StoreError(message: "Buchung nicht gefunden.") }
        return try decode(record).profileID
    }
    public func saveEntity(_ profile: String, _ kind: String, _ data: [String: Any]) throws -> [String: Any] {
        try transaction {
            try requireProfile(profile)
            guard Self.kinds.contains(kind) else { throw StoreError(message: "Unbekannter Datentyp.") }
            var value = data
            let portableID = data["syncId"] as? String ?? UUID().uuidString.lowercased()
            let id = kind == "transactions" ? Self.stableIdentity("native-transaction:\(profile)", portableID) : (data["id"] as? String) ?? UUID().uuidString.lowercased()
            value["id"] = id
            if kind == "transactions" { value["syncId"] = portableID; value["importedAt"] = value["importedAt"] ?? Self.now() }
            value = try Self.canonicalMoney(kind, value)
            try validate(kind, value)
            try put(profile, kind, id, value)
            return value
        }
    }
    public func editTransaction(_ id: String, _ changes: [String: Any]) throws {
        try transaction {
            let profile = try transactionProfile(id)
            var value = try find(profile, "transactions", id)!.payload
            for (key, newValue) in changes where !["id", "syncId", "profileId"].contains(key) { value[key] = newValue }
            try validate("transactions", value)
            try put(profile, "transactions", id, value)
        }
    }
    public func deleteEntity(_ profile: String, _ kind: String, _ id: String) throws {
        try transaction {
            try requireProfile(profile)
            guard let value = try find(profile, kind, id), value.deletedAt == nil else { return }
            try put(profile, kind, id, value.payload, deletedAt: Self.now())
            if kind == "categories" {
                for record in try records(profile, "transactions") where record.payload["category"] as? String == id {
                    var tx = record.payload; tx["category"] = "sonstiges"; try put(profile, "transactions", record.id, tx)
                }
            }
        }
    }
    public func updateAccount(_ profile: String, _ id: String, _ changes: [String: Any]) throws {
        try transaction {
            try requireProfile(profile)
            guard var value = try find(profile, "accounts", id)?.payload else { throw StoreError(message: "Konto nicht gefunden.") }
            for key in ["initialBalance", "initialBalanceDate", "checkpointBalance", "checkpointDate", "iban"] {
                if let change = changes[key] { value[key] = change }
            }
            try validate("accounts", value); try put(profile, "accounts", id, value)
        }
    }
    public func importRulesPackage(_ profile: String, categories: [[String: Any]], rules: [[String: Any]],
                                   expectedCategories: [[String: Any]], expectedRules: [[String: Any]]) throws -> [String: Int] {
        try transaction {
            try requireProfile(profile)
            func canonical(_ values: [[String: Any]]) throws -> String {
                try Self.json(values.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") })
            }
            let currentCategories = try records(profile, "categories").map(\.payload)
            let currentRules = try records(profile, "rules").map(\.payload)
            guard try canonical(currentCategories) == canonical(expectedCategories), try canonical(currentRules) == canonical(expectedRules) else {
                throw StoreError(message: "Regeln oder Kategorien wurden zwischenzeitlich geändert. Bitte den Import erneut öffnen.")
            }
            var categoryIDs = Set(currentCategories.compactMap { $0["id"] as? String })
            var ruleIDs = Set(currentRules.compactMap { $0["id"] as? String })
            for category in categories {
                guard let id = category["id"] as? String, !id.isEmpty, !categoryIDs.contains(id),
                      let name = category["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      category["icon"] is String, category["color"] is String,
                      ["expense", "income", "transfer"].contains(category["type"] as? String ?? "") else {
                    throw StoreError(message: "Ungültige oder bereits vorhandene Kategorie. Nichts verändert.")
                }
                categoryIDs.insert(id)
                _ = try saveEntity(profile, "categories", category)
            }
            for rule in rules {
                guard let id = rule["id"] as? String, !id.isEmpty, !ruleIDs.contains(id),
                      rule["name"] is String, let category = rule["applyCategory"] as? String, categoryIDs.contains(category),
                      let conditions = rule["conditions"] as? [[String: Any]], !conditions.isEmpty else {
                    throw StoreError(message: "Ungültige oder bereits vorhandene Regel. Nichts verändert.")
                }
                ruleIDs.insert(id)
                _ = try saveEntity(profile, "rules", rule)
            }
            return ["categoriesAdded": categories.count, "rulesAdded": rules.count]
        }
    }
    public func loadStandardRules(_ profile: String, _ rules: [[String: Any]]) throws -> [String: Int] {
        try transaction {
            var inserted = 0, updated = 0
            for rule in rules {
                guard let id = rule["id"] as? String else { throw StoreError(message: "Ungültige Standardregel.") }
                var merged = rule
                if let old = try find(profile, "rules", id), old.deletedAt == nil {
                    merged["enabled"] = old.payload["enabled"] ?? true
                    if try Self.json(merged) == Self.json(old.payload) { continue }
                    updated += 1
                } else { inserted += 1 }
                _ = try saveEntity(profile, "rules", merged)
            }
            return ["inserted": inserted, "updated": updated]
        }
    }
    public func batchImport(_ profile: String, _ items: [[String: Any]], _ checkpoint: [String: Any]?, appendOnly: Bool = false, reviewedHashes: Set<String> = []) throws -> [String: Int] {
        try transaction {
            try requireProfile(profile)
            var inserted = 0, updated = 0, duplicates = 0
            let existing = try records(profile, "transactions")
            if appendOnly {
                for value in items {
                    guard let date = value["date"] as? String, let account = value["account"] as? String,
                          let hash = value["sourceHash"] as? String else { throw StoreError(message: "Ungültige Bankbuchung.") }
                    if existing.contains(where: { $0.payload["account"] as? String == account && $0.payload["sourceHash"] as? String == hash }) { continue }
                    let historical = existing.contains { old in
                        old.payload["account"] as? String == account && (old.payload["date"] as? String ?? "") >= date &&
                        !(old.payload["sourceHash"] as? String ?? "").hasPrefix("comdirect_api_") && old.payload["isManual"] as? Bool != true
                    }
                    if historical && !reviewedHashes.contains(hash) { throw StoreError(message: "Historische Überschneidung noch nicht geprüft. Bitte die Vorschau erneut abrufen.") }
                }
                var linked = [String: String]()
                var targets = [String: String]()
                for value in existing.map({ $0.payload }) + items {
                    guard let hash = value["sourceHash"] as? String, hash.hasPrefix("comdirect_api_") else { continue }
                    guard let data = String(hash.dropFirst("comdirect_api_".count)).data(using: .utf8),
                          let reference = try JSONSerialization.jsonObject(with: data) as? [String], reference.count == 2,
                          !reference[0].isEmpty, !reference[1].isEmpty, let account = value["account"] as? String else {
                        throw StoreError(message: "Ungültige Bankreferenz. Nichts gespeichert.")
                    }
                    if let previous = linked[reference[0]], previous != account { throw StoreError(message: "Dieses Bankkonto ist bereits einem anderen Zielkonto zugeordnet.") }
                    if let previous = targets[account], previous != reference[0] { throw StoreError(message: "Dieses Zielkonto gehört zu einem anderen Bankkonto.") }
                    linked[reference[0]] = account
                    targets[account] = reference[0]
                }
            }
            var byHash = Dictionary(grouping: existing, by: { ($0.payload["account"] as? String ?? "") + ":" + ($0.payload["sourceHash"] as? String ?? "") })
            var consumed = Set<String>()
            var occurrences = [String: Int]()
            for original in items {
                var value = original
                let account = value["account"] as? String ?? "comdirect Girokonto"
                let hash = value["sourceHash"] as? String ?? ""
                guard !hash.isEmpty else { throw StoreError(message: "Import-Fingerprint fehlt.") }
                if appendOnly {
                    guard hash.hasPrefix("comdirect_api_"), value["status"] as? String == "booked", value["currency"] as? String == "EUR" else {
                        throw StoreError(message: "Ungültige Buchungen im Bankabruf. Nichts gespeichert.")
                    }
                    if byHash[account + ":" + hash]?.isEmpty == false { duplicates += 1; continue }
                }
                let key = account + ":" + hash
                let n = (occurrences[key] ?? 0) + 1; occurrences[key] = n
                if let duplicate = byHash[key]?.first(where: { !consumed.contains($0.id) }) {
                    consumed.insert(duplicate.id)
                    if duplicate.payload["status"] as? String == "pending" && value["status"] as? String == "booked" {
                        var promoted = duplicate.payload; promoted["status"] = "booked"
                        try put(profile, "transactions", duplicate.id, promoted); updated += 1
                    } else { duplicates += 1 }
                    continue
                }
                let cents = try Self.cents(value["amount"])
                let payee = (value["payee"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                let pending = existing.first { record in
                    record.payload["status"] as? String == "pending" && !consumed.contains(record.id) &&
                    record.payload["date"] as? String == value["date"] as? String &&
                    (try? Self.cents(record.payload["amount"])) == cents &&
                    (record.payload["payee"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == payee &&
                    record.payload["account"] as? String == account
                }
                if !appendOnly, let pending, value["status"] as? String != "pending" {
                    var promoted = pending.payload
                    for field in ["status", "rawText", "type", "sourceHash", "valutaDate"] { if let new = value[field] { promoted[field] = new } }
                    promoted["status"] = "booked"
                    try put(profile, "transactions", pending.id, promoted)
                    consumed.insert(pending.id); updated += 1
                } else {
                    let portableID = Self.stableIdentity("transaction:\(profile)", "import:\(account):\(hash):\(n)")
                    let id = Self.stableIdentity("native-transaction:\(profile)", portableID)
                    value["id"] = id; value["syncId"] = portableID; value["account"] = account
                    value["importedAt"] = value["importedAt"] ?? Self.now()
                    try validate("transactions", value)
                    // A tombstone prevents a stale CSV from resurrecting a deleted transaction.
                    if let old = try find(profile, "transactions", id), old.deletedAt != nil { duplicates += 1; continue }
                    try put(profile, "transactions", id, value)
                    if let added = try find(profile, "transactions", id) { byHash[key, default: []].append(added); consumed.insert(id) }
                    inserted += 1
                }
            }
            if !appendOnly, let checkpoint, let balance = checkpoint["newBalance"], !(balance is NSNull) {
                _ = try Self.cents(balance)
                if let account = try find(profile, "accounts", "comdirect") {
                    let end = checkpoint["endDate"] as? String ?? items.compactMap { $0["date"] as? String }.max() ?? Self.now().prefix(10).description
                    let oldDate = account.payload["checkpointDate"] as? String ?? ""
                    if end >= oldDate {
                        var changes: [String: Any] = ["checkpointBalance": balance, "checkpointDate": end]
                        if let iban = checkpoint["iban"] as? String { changes["iban"] = iban }
                        try updateAccount(profile, "comdirect", changes)
                    }
                }
            }
            return ["inserted": inserted, "updated": updated, "duplicates": duplicates]
        }
    }
    private func snapshot(_ profile: String) throws -> [String: Any] {
        var data = try profileData(profile)
        var p = data["profile"] as? [String: Any] ?? [:]; p["hasPin"] = false
        let extra = try metadata("backupExtra:\(profile)").map(Self.object) ?? [:]
        data.merge(extra) { current, _ in current }
        data["profile"] = p; data["profileId"] = profile; data["profileName"] = p["name"]
        data["includedCollections"] = Self.kinds
        data["syncConflicts"] = try records(profile, "conflicts").map { conflict in
            var value = conflict.payload
            if let id = value["recordId"] as? String, let current = try record(id) { value["current"] = current.envelope }
            return value
        }
        return data
    }
    public func exportBackup(_ profile: String, all: Bool) throws -> [String: Any] {
        try transaction {
            var root = try snapshot(profile)
            var extras = [[String: Any]](), profileList = [root["profile"] as? [String: Any] ?? [:]]
            if all {
                for other in try profiles() where other["id"] as? String != profile {
                    guard let id = other["id"] as? String else { continue }
                    let data = try snapshot(id); extras.append(data); profileList.append(data["profile"] as? [String: Any] ?? [:])
                }
            }
            root["format"] = "dagobert_backup"; root["schemaVersion"] = 2; root["sourcePlatform"] = "ios"; root["exportedAt"] = Self.now()
            root["profiles"] = profileList; root["additionalProfiles"] = extras
            return root
        }
    }
    public func importBackup(_ target: String, _ payload: [String: Any], mode: String) throws -> [String] {
        try transaction {
            guard ["replace", "merge", "new_profile"].contains(mode), payload["format"] as? String == "dagobert_backup",
                  (payload["schemaVersion"] as? Int) == 2 else { throw StoreError(message: "Nicht unterstütztes Backupformat.") }
            let snapshots = [payload] + (payload["additionalProfiles"] as? [[String: Any]] ?? [])
            var imported = [String](), used = Set<String>()
            for (index, snapshot) in snapshots.enumerated() {
                guard let source = snapshot["profileId"] as? String, let name = snapshot["profileName"] as? String else { throw StoreError(message: "Profilzuordnung fehlt.") }
                let id = mode == "new_profile" ? UUID().uuidString.lowercased() : index == 0 ? target : source
                guard used.insert(id).inserted else { throw StoreError(message: "Doppelte Profilzuordnung.") }
                var p = snapshot["profile"] as? [String: Any] ?? ["name": name, "icon": "User", "color": "#0A84FF"]
                for key in ["pin", "pinHash", "pin_hash", "credentialId"] { p.removeValue(forKey: key) }
                p["id"] = id; p["hasPin"] = nil
                if mode == "new_profile" { p["isDefault"] = false }
                if try find(id, "profiles", id) == nil || mode == "replace" { try put(id, "profiles", id, p) }
                let included = snapshot["includedCollections"] as? [String] ?? Self.kinds
                for kind in Self.kinds where included.contains(kind) {
                    guard let values = snapshot[kind] as? [[String: Any]] else { throw StoreError(message: "Unvollständiger Profilbestand.") }
                    let current = try records(id, kind, includeDeleted: true)
                    var retained = Set<String>(), occurrences = [String: Int]()
                    for original in values {
                        var value = original
                        let key: String
                        if kind == "transactions" {
                            let fingerprint = "\(value["account"] as? String ?? ""):\(value["sourceHash"] as? String ?? "")"
                            let n = (occurrences[fingerprint] ?? 0) + 1; occurrences[fingerprint] = n
                            let legacyID = value["id"].map { String(describing: $0) }
                            let portableID = value["syncId"] as? String ?? Self.stableIdentity("transaction:\(source)", legacyID.map { "id:\($0)" } ?? "import:\(fingerprint):\(n)")
                            key = Self.stableIdentity("native-transaction:\(id)", portableID)
                            value["id"] = key; value["syncId"] = portableID
                        } else {
                            guard let entityID = value["id"] as? String else { throw StoreError(message: "Datensatz-ID fehlt.") }; key = entityID
                        }
                        guard retained.insert(key).inserted else { throw StoreError(message: "Doppelte Datensatz-ID im Backup.") }
                        value = try Self.canonicalMoney(kind, value)
                        try validate(kind, value)
                        if mode == "merge", let old = current.first(where: { $0.id == key }) {
                            if old.deletedAt != nil || !Self.equal(old.payload, value) {
                                throw StoreError(message: "Das Backup enthält abweichende oder gelöschte Einträge. Bitte als neues Profil importieren oder bewusst ersetzen.")
                            }
                        } else { try put(id, kind, key, value) }
                    }
                    if mode == "replace" {
                        for old in current where !retained.contains(old.id) && old.deletedAt == nil { try put(id, kind, old.id, old.payload, deletedAt: Self.now()) }
                    }
                }
                try restoreConflicts(snapshot, source: source, target: id, mode: mode)
                var extra = snapshot
                for key in Self.kinds + ["profile", "profiles", "additionalProfiles", "format", "schemaVersion", "exportedAt", "sourcePlatform", "syncConflicts"] { extra.removeValue(forKey: key) }
                try setMetadata("backupExtra:\(id)", Self.json(extra))
                imported.append(id)
            }
            return imported
        }
    }
    private func restoreConflicts(_ snapshot: [String: Any], source: String, target: String, mode: String) throws {
        guard snapshot["syncConflicts"] == nil || snapshot["syncConflicts"] is [[String: Any]] else { throw StoreError(message: "Ungültige Konfliktsicherung.") }
        let incoming = snapshot["syncConflicts"] as? [[String: Any]] ?? []
        var retained = Set<String>()
        for original in incoming {
            guard let oldRecordID = original["recordId"] as? String, let oldID = original["id"] as? String,
                  let rawVersions = original["versions"] as? [[String: Any]], rawVersions.count >= 2 else { throw StoreError(message: "Unvollständige Konfliktsicherung.") }
            var changes = Set<String>()
            func remap(_ envelope: [String: Any]) throws -> [String: Any] {
                guard envelope["schemaVersion"] as? Int == 2, envelope["profileId"] as? String == source,
                      let kind = envelope["kind"] as? String, Self.kinds.contains(kind) || kind == "profiles",
                      let entityID = envelope["id"] as? String, let change = envelope["changeId"] as? String, !change.isEmpty,
                      let raw = envelope["data"] as? [String: Any], raw["id"] as? String == entityID,
                      oldRecordID == Self.stableIdentity("record:\(source):\(kind)", entityID) else { throw StoreError(message: "Ungültige Konfliktzuordnung.") }
                var value = try Self.canonicalMoney(kind, raw), result = envelope
                let id: String
                if kind == "transactions" {
                    let portable = value["syncId"] as? String ?? Self.stableIdentity("transaction:\(source)", "id:\(entityID)")
                    id = Self.stableIdentity("native-transaction:\(target)", portable)
                    value["syncId"] = portable
                } else { id = kind == "profiles" ? target : entityID }
                value["id"] = id
                if kind == "profiles", mode == "new_profile" { value["isDefault"] = false }
                if Self.kinds.contains(kind) { try validate(kind, value) }
                result["profileId"] = target; result["id"] = id; result["data"] = value
                if source != target { result["resolves"] = [String]() }
                return result
            }
            let versions = try rawVersions.map { version -> [String: Any] in
                guard let change = version["changeId"] as? String, changes.insert(change).inserted else { throw StoreError(message: "Doppelte Konfliktversion.") }
                return try remap(version)
            }
            guard oldID == Self.stableIdentity("conflict:\(oldRecordID)", changes.sorted().joined(separator: ":")),
                  let kind = versions[0]["kind"] as? String, let entityID = versions[0]["id"] as? String else { throw StoreError(message: "Ungültige Konfliktidentität.") }
            let recordID = Self.stableIdentity("record:\(target):\(kind)", entityID)
            let id = Self.stableIdentity("conflict:\(recordID)", changes.sorted().joined(separator: ":"))
            guard retained.insert(id).inserted else { throw StoreError(message: "Doppelte Konfliktidentität.") }
            var value = original
            value["id"] = id; value["recordId"] = recordID; value["versions"] = versions
            let current: [String: Any]
            if let raw = original["current"] as? [String: Any] {
                current = try remap(raw)
                guard versions.contains(where: { (try? Self.json($0)) == (try? Self.json(current)) }) else { throw StoreError(message: "Aktuelle Konfliktversion fehlt.") }
            } else if let old = try find(target, kind, entityID), let version = versions.first(where: {
                Self.equal($0["data"] as? [String: Any] ?? [:], old.payload) && $0["deletedAt"] as? String == old.deletedAt
            }) { current = version }
            else { throw StoreError(message: "Die aktuelle Konfliktversion fehlt im Backup. Bitte die Original-App aktualisieren und erneut exportieren.") }
            if let entity = try find(target, kind, entityID), entity.deletedAt == nil,
               !Self.equal(entity.payload, current["data"] as? [String: Any] ?? [:]) || current["deletedAt"] != nil {
                throw StoreError(message: "Der Datensatz wurde außerhalb der Konfliktauflösung verändert. Bitte zuerst die Konflikte in der Original-App auflösen; es wurden keine Daten übernommen.")
            }
            value.removeValue(forKey: "current")
            if mode == "merge", let existing = try find(target, "conflicts", id), !Self.equal(existing.payload, value) {
                throw StoreError(message: "Abweichende Konfliktsicherung. Bitte getrennt als neues Profil importieren.")
            }
            try put(target, kind, entityID, current["data"] as? [String: Any] ?? [:], deletedAt: current["deletedAt"] as? String)
            try execute("UPDATE records SET change_id=?,revision=?,blocked=1 WHERE record_id=?", [current["changeId"], current["revision"] as? Int ?? 1, recordID])
            try put(target, "conflicts", id, value)
        }
        if mode == "replace", try records(target, "conflicts").contains(where: { !retained.contains($0.id) }) {
            throw StoreError(message: "Vorhandene Konflikte fehlen in dieser Sicherung. Bitte zuerst auflösen oder als neues Profil importieren.")
        }
    }
    public func resetProfile(_ profile: String) throws {
        try transaction {
            try requireProfile(profile)
            for record in try records(profile) where Self.kinds.contains(record.kind) { try put(profile, record.kind, record.id, record.payload, deletedAt: Self.now()) }
            try seed(profile)
        }
    }
    private static func equal(_ a: [String: Any], _ b: [String: Any]) -> Bool {
        var a = a, b = b
        for key in ["id", "syncId", "importedAt", "hasPin"] { a.removeValue(forKey: key); b.removeValue(forKey: key) }
        return (try? json(a)) == (try? json(b))
    }
    private func validate(_ kind: String, _ data: [String: Any]) throws {
        guard let id = data["id"] as? String, !id.isEmpty else { throw StoreError(message: "Datensatz-ID fehlt.") }
        if kind == "transactions" {
            for key in ["date", "currency", "payee", "purpose", "rawText", "type", "category", "account", "sourceHash", "importedAt"] {
                guard data[key] is String else { throw StoreError(message: "Buchung ist unvollständig.") }
            }
            _ = try Self.cents(data["amount"])
            guard ["booked", "pending"].contains(data["status"] as? String ?? "booked") else { throw StoreError(message: "Unbekannter Buchungsstatus.") }
        } else if kind == "accounts" {
            _ = try Self.cents(data["initialBalance"])
            if let value = data["checkpointBalance"], !(value is NSNull) { _ = try Self.cents(value) }
        } else if kind == "categories", let value = data["budget"], !(value is NSNull) { _ = try Self.cents(value) }
        for field in kind == "transactions" ? ["date", "valutaDate"] : kind == "accounts" ? ["initialBalanceDate", "checkpointDate"] : [] {
            if let text = data[field] as? String, !text.isEmpty {
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
                formatter.calendar = Calendar(identifier: .gregorian); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
                guard let parsed = formatter.date(from: text), formatter.string(from: parsed) == text else { throw StoreError(message: "Ungültiges Kalenderdatum.") }
            } else if field == "date" || field == "initialBalanceDate" { throw StoreError(message: "Saldostichtag oder Buchungsdatum fehlt.") }
        }
        if kind == "rules" {
            guard let conditions = data["conditions"] as? [[String: Any]], data["enabled"] is NSNumber, data["priority"] is NSNumber,
                  data["applyCategory"] is String else { throw StoreError(message: "Unvollständige Kategorisierungsregel.") }
            for condition in conditions {
                guard ["payee", "purpose", "rawText", "type", "amount"].contains(condition["field"] as? String ?? ""),
                    ["contains", "equals", "startsWith", "regex", "greaterThan", "lessThan"].contains(condition["operator"] as? String ?? ""),
                    condition["value"] is String else { throw StoreError(message: "Unbekannte Regelbedingung.") }
            }
        }
        if kind == "bankTemplates" {
            guard let columns = data["columns"] as? [String: Any], ["date", "rawText", "amount"].allSatisfy({ columns[$0] is String }) else { throw StoreError(message: "Ungültige Bankvorlage.") }
        }
        _ = try Self.json(data)
    }

    // Durable outbox and acknowledgements are part of the same transaction as the data.
    public func pending() throws -> [SyncRecord] {
        lock.lock(); defer { lock.unlock() }
        return try rows("SELECT * FROM records WHERE dirty=1 AND blocked=0 ORDER BY kind,id").map(decode)
    }
    public func pendingCount() throws -> Int {
        lock.lock(); defer { lock.unlock() }
        return Int(try rows("SELECT count(*) AS n FROM records WHERE dirty=1").first?["n"] as? Int64 ?? 0)
    }
    public func acknowledge(_ recordID: String, changeID: String, systemFields: Data, sentEnvelope: [String: Any]? = nil) throws {
        try transaction {
            guard let current = try record(recordID) else { return }
            try execute("UPDATE records SET system_fields=?, base_payload=?, dirty=CASE WHEN change_id=? THEN 0 ELSE dirty END WHERE record_id=?",
                [systemFields, Self.json(sentEnvelope ?? current.envelope), changeID, recordID])
        }
    }
    public func applyRemote(_ envelope: [String: Any], recordID: String, systemFields: Data) throws {
        try transaction {
            guard envelope["schemaVersion"] as? Int == 2, let profile = envelope["profileId"] as? String,
                  let kind = envelope["kind"] as? String, let id = envelope["id"] as? String,
                  let rawValue = envelope["data"] as? [String: Any], let changeID = envelope["changeId"] as? String,
                  Self.kinds.contains(kind) || ["profiles", "conflicts"].contains(kind) else { throw StoreError(message: "Unbekannter iCloud-Datensatz. Bitte Dagobert aktualisieren.") }
            guard recordID == Self.stableIdentity("record:\(profile):\(kind)", id) else { throw StoreError(message: "Ungültige iCloud-Datensatzidentität.") }
            let value = try Self.canonicalMoney(kind, rawValue)
            guard value["id"] as? String == id else { throw StoreError(message: "iCloud-Inhalt und Datensatzidentität stimmen nicht überein.") }
            var envelope = envelope
            envelope["data"] = value
            let deleted = envelope["deletedAt"] as? String
            if Self.kinds.contains(kind) { try validate(kind, value) }
            let previousRow = try rows("SELECT * FROM records WHERE record_id=?", [recordID]).first
            let resolves = envelope["resolves"] as? [String] ?? []
            var resolutionCoversCurrent = false
            if let old = try record(recordID) {
                for conflictID in resolves {
                    if let conflict = try find(profile, "conflicts", conflictID),
                       let versions = conflict.payload["versions"] as? [[String: Any]],
                       versions.contains(where: { $0["changeId"] as? String == old.changeID }) { resolutionCoversCurrent = true }
                }
            }
            if let previousRow, let old = try record(recordID), previousRow["dirty"] as? Int64 == 1, previousRow["seeded"] as? Int64 != 1, !resolutionCoversCurrent {
                let base = try (previousRow["base_payload"] as? String).map(Self.object)
                if old.changeID == changeID || (Self.equal(old.payload, value) && old.deletedAt == deleted) {
                    try acknowledge(recordID, changeID: old.changeID, systemFields: systemFields, sentEnvelope: envelope)
                    try execute("UPDATE records SET blocked=0 WHERE record_id=?", [recordID])
                    return
                }
                if let base, Self.equal(base["data"] as? [String: Any] ?? [:], value), base["deletedAt"] as? String == deleted {
                    try execute("UPDATE records SET system_fields=?,base_payload=? WHERE record_id=?", [systemFields, Self.json(envelope), recordID]); return
                }
                // Preserve both complete versions and block this record until the user resolves it.
                let conflictID = Self.stableIdentity("conflict:\(recordID)", [old.changeID, changeID].sorted().joined(separator: ":"))
                if kind == "conflicts" { throw StoreError(message: "Gleichzeitige Konfliktauflösung erkannt. Bitte erneut synchronisieren.") }
                let versions = [old.envelope, envelope].sorted { ($0["changeId"] as? String ?? "") < ($1["changeId"] as? String ?? "") }
                try put(profile, "conflicts", conflictID, ["id": conflictID, "recordId": recordID, "versions": versions])
                try execute("UPDATE records SET blocked=1,system_fields=?,base_payload=? WHERE record_id=?", [systemFields, Self.json(envelope), recordID])
                return
            }
            try execute("INSERT OR IGNORE INTO record_scopes(id) VALUES (?)", [profile])
            try execute("""
                INSERT INTO records(profile_id,kind,id,record_id,payload,amount_cents,revision,change_id,deleted_at,dirty,system_fields,base_payload,resolves)
                VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?) ON CONFLICT(profile_id,kind,id) DO UPDATE SET
                payload=excluded.payload,amount_cents=excluded.amount_cents,revision=excluded.revision,change_id=excluded.change_id,
                deleted_at=excluded.deleted_at,dirty=0,seeded=0,blocked=0,system_fields=excluded.system_fields,base_payload=excluded.base_payload,resolves=excluded.resolves
                """, [profile, kind, id, recordID, Self.json(value), kind == "transactions" ? try Self.cents(value["amount"]) : nil,
                        envelope["revision"] as? Int ?? 1, changeID, deleted, systemFields, Self.json(envelope), Self.json(resolves)])
        }
    }
    public func conflicts() throws -> [[String: Any]] { try records(nil, "conflicts").map(\.payload) }
    public func resolveConflict(_ id: String, version: Int) throws {
        try transaction {
            guard let conflict = try records(nil, "conflicts").first(where: { $0.id == id }),
                  let versions = conflict.payload["versions"] as? [[String: Any]], versions.indices.contains(version),
                  let profile = versions[version]["profileId"] as? String, let kind = versions[version]["kind"] as? String,
                  let entityID = versions[version]["id"] as? String, let data = versions[version]["data"] as? [String: Any] else {
                throw StoreError(message: "Konflikt nicht gefunden.")
            }
            try put(profile, kind, entityID, data, deletedAt: versions[version]["deletedAt"] as? String)
            let resolved = Array(Set((try find(profile, kind, entityID)?.resolves ?? []) + [id])).sorted()
            try execute("UPDATE records SET blocked=0,dirty=1,change_id=?,revision=revision+1,resolves=? WHERE profile_id=? AND kind=? AND id=?", [UUID().uuidString.lowercased(), Self.json(resolved), profile, kind, entityID])
            try put(conflict.profileID, "conflicts", conflict.id, conflict.payload, deletedAt: Self.now())
        }
    }
    public func markAllPending(clearSystemFields: Bool) throws {
        _ = try transaction {
            try execute("UPDATE records SET dirty=1" + (clearSystemFields ? ",system_fields=NULL,base_payload=NULL" : ""))
        }
    }
    public func serverDeleted(_ recordID: String) throws {
        try transaction {
            // App deletions are tombstones. A hard server deletion requires review, never resurrection.
            guard let record = try record(recordID) else { return }
            let envelope = record.envelope.merging(["deletedAt": Self.now(), "changeId": UUID().uuidString.lowercased()]) { _, new in new }
            try applyRemote(envelope, recordID: recordID, systemFields: record.systemFields ?? Data())
        }
    }
    private func migrateLegacy() throws {
        guard try metadata("legacyMigrated") == nil else { return }
        guard !(try rows("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'")).isEmpty else {
            try setMetadata("legacyMigrated", "1"); return
        }
        try transaction {
            for p in try rows("SELECT * FROM profiles") {
                guard let id = p["id"] as? String else { throw StoreError(message: "Altes Profil ist unvollständig.") }
                let profile: [String: Any] = ["id": id, "name": p["name"] ?? "Privat", "icon": p["icon"] ?? "User", "color": p["color"] ?? "#0A84FF", "isDefault": (p["is_default"] as? Int64 ?? 0) != 0, "createdAt": p["created_at"] ?? Self.now()]
                try put(id, "profiles", id, profile, deletedAt: p["deleted_at"] as? String)
                if let hash = p["pin_hash"] as? String { try setPinHash(id, hash) }
                for kind in Self.kinds {
                    let table = kind == "bankTemplates" ? "bank_templates" : kind
                    for row in try rows("SELECT * FROM \(table) WHERE profile_id=?", [id]) {
                        var value = row
                        let aliases = ["initial_balance_date": "initialBalanceDate", "checkpoint_date": "checkpointDate", "valuta_date": "valutaDate", "raw_text": "rawText", "source_hash": "sourceHash", "imported_at": "importedAt", "is_manual": "isManual", "apply_category": "applyCategory", "header_identifier": "headerIdentifier", "text_parser": "textParser", "date_format": "dateFormat"]
                        for (snake, camel) in aliases { if let v = value.removeValue(forKey: snake) { value[camel] = v } }
                        for (column, key) in ["amount_cents": "amount", "budget_cents": "budget", "initial_balance_cents": "initialBalance", "checkpoint_balance_cents": "checkpointBalance"] {
                            if let original = value.removeValue(forKey: column) {
                                if let cents = original as? Int64 { value[key] = Double(cents) / 100 }
                                else if original is NSNull { value[key] = NSNull() }
                                else { throw StoreError(message: "Ungültiger Centbetrag im Altbestand.") }
                            }
                        }
                        for field in ["conditions", "columns"] { if let json = value[field] as? String, let bytes = json.data(using: .utf8) { value[field] = try JSONSerialization.jsonObject(with: bytes) } }
                        if let enabled = value["enabled"] as? Int64 { value["enabled"] = enabled != 0 }
                        if let manual = value["isManual"] as? Int64 { value["isManual"] = manual != 0 }
                        guard let entityID = value["id"] as? String else { throw StoreError(message: "Alte Datensatz-ID fehlt.") }
                        if kind == "transactions" { value["syncId"] = entityID }
                        let deleted = value["deleted_at"] as? String
                        for key in ["profile_id", "deleted_at", "updated_at", "created_at", "legacy_id"] { value.removeValue(forKey: key) }
                        try put(id, kind, entityID, value, deletedAt: deleted)
                    }
                }
            }
            // Legacy tables remain untouched so migration never destroys the previous store.
            try setMetadata("legacyMigrated", "1")
        }
    }
}
