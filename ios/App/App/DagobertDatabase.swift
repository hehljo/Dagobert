import Foundation
import SQLite3

public final class DagobertDatabase {
    public static let shared = DagobertDatabase()

    private var db: OpaquePointer?
    private let queue = DispatchQueue(label: "de.dagobert.database", qos: .userInitiated)

    private init() {
        openDatabase()
        createTables()
        seedDefaultsIfNeeded()
    }

    deinit {
        if db != nil {
            sqlite3_close(db)
        }
    }

    // MARK: - Open & File Protection

    private func openDatabase() {
        let fileManager = FileManager.default
        guard let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            fatalError("Konnte ApplicationSupportDirectory nicht finden.")
        }

        let dagobertDir = appSupport.appendingPathComponent("Dagobert", isDirectory: true)
        if !fileManager.fileExists(atPath: dagobertDir.path) {
            try? fileManager.createDirectory(at: dagobertDir, withIntermediateDirectories: true, attributes: [
                .protectionKey: FileProtectionType.complete
            ])
        }

        let dbURL = dagobertDir.appendingPathComponent("dagobert_local.sqlite")

        if sqlite3_open_v2(dbURL.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) != SQLITE_OK {
            let errmsg = String(cString: sqlite3_errmsg(db))
            fatalError("Fehler beim Öffnen der SQLite-Datenbank: \(errmsg)")
        }

        // Apply File Protection
        try? fileManager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: dbURL.path)

        // Enable WAL mode & foreign keys
        exec("PRAGMA journal_mode = WAL;")
        exec("PRAGMA foreign_keys = ON;")
        exec("PRAGMA synchronous = NORMAL;")
    }

    private func exec(_ sql: String) {
        var errorMsg: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(db, sql, nil, nil, &errorMsg) != SQLITE_OK {
            let msg = errorMsg != nil ? String(cString: errorMsg!) : "Unbekannter Fehler"
            sqlite3_free(errorMsg)
            print("SQLite EXEC Fehler bei [\(sql)]: \(msg)")
        }
    }

    // MARK: - Schema

    private func createTables() {
        exec("""
        CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT 'User',
            color TEXT NOT NULL DEFAULT '#0A84FF',
            pin_hash TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            name TEXT NOT NULL,
            iban TEXT,
            initial_balance_cents INTEGER NOT NULL DEFAULT 0,
            initial_balance_date TEXT NOT NULL,
            checkpoint_balance_cents INTEGER,
            checkpoint_date TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (id, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS categories (
            id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            name TEXT NOT NULL,
            icon TEXT NOT NULL,
            color TEXT NOT NULL,
            type TEXT NOT NULL,
            budget_cents INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (id, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS rules (
            id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            name TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 20,
            conditions TEXT NOT NULL,
            apply_category TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (id, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            legacy_id INTEGER,
            profile_id TEXT NOT NULL,
            date TEXT NOT NULL,
            valuta_date TEXT,
            amount_cents INTEGER NOT NULL,
            currency TEXT NOT NULL DEFAULT 'EUR',
            payee TEXT NOT NULL,
            purpose TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            type TEXT NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT,
            account TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'booked',
            source_hash TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            is_manual INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tx_profile_date ON transactions(profile_id, date);
        CREATE INDEX IF NOT EXISTS idx_tx_hash ON transactions(profile_id, source_hash);
        CREATE INDEX IF NOT EXISTS idx_tx_deleted ON transactions(deleted_at);

        CREATE TABLE IF NOT EXISTS bank_templates (
            id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            encoding TEXT NOT NULL DEFAULT 'windows-1252',
            delimiter TEXT NOT NULL DEFAULT ';',
            header_identifier TEXT NOT NULL,
            columns TEXT NOT NULL,
            text_parser TEXT NOT NULL DEFAULT 'comdirect',
            date_format TEXT NOT NULL DEFAULT 'DD.MM.YYYY',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT,
            PRIMARY KEY (id, profile_id),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sync_queue (
            record_type TEXT NOT NULL,
            record_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (record_type, record_id)
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """)
    }

    // MARK: - Defaults Seeding

    private func seedDefaultsIfNeeded() {
        let count = scalarInt("SELECT count(*) FROM profiles WHERE deleted_at IS NULL;")
        if count == 0 {
            let now = ISO8601DateFormatter().string(from: Date())
            let defaultProfileId = "privat"

            exec("""
            INSERT OR IGNORE INTO profiles (id, name, icon, color, is_default, created_at, updated_at)
            VALUES ('\(defaultProfileId)', 'Privat', 'User', '#0A84FF', 1, '\(now)', '\(now)');
            """)

            seedProfileDefaults(profileId: defaultProfileId)
        }
    }

    public func seedProfileDefaults(profileId: String) {
        let now = ISO8601DateFormatter().string(from: Date())

        // Default Account
        exec("""
        INSERT OR IGNORE INTO accounts (id, profile_id, name, initial_balance_cents, initial_balance_date, created_at, updated_at)
        VALUES ('comdirect', '\(profileId)', 'comdirect Girokonto', 0, '2026-01-01', '\(now)', '\(now)');
        """)

        // Default Categories
        let categories: [(String, String, String, String, String)] = [
            ("lebensmittel", "Lebensmittel & Supermarkt", "ShoppingCart", "#30D158", "expense"),
            ("wohnen", "Wohnen & Miete", "Home", "#0A84FF", "expense"),
            ("mobilitaet", "Mobilität & Transport", "Car", "#FF9F0A", "expense"),
            ("freizeit", "Freizeit & Restaurant", "Utensils", "#FF375F", "expense"),
            ("abos", "Abos & Verträge", "Smartphone", "#BF5AF2", "expense"),
            ("shopping", "Shopping & Kleidung", "ShoppingBag", "#FFD60A", "expense"),
            ("gesundheit", "Gesundheit & Pflege", "HeartPulse", "#64D2FF", "expense"),
            ("investieren", "Sparen & Investieren", "TrendingUp", "#5E5CE6", "transfer"),
            ("gehalt", "Gehalt & Einkommen", "Briefcase", "#32D74B", "income"),
            ("rueckerstattung", "Rückerstattungen", "RotateCcw", "#40C8E0", "income"),
            ("sonstiges", "Sonstiges", "Package", "#8E8E93", "expense")
        ]

        for cat in categories {
            exec("""
            INSERT OR IGNORE INTO categories (id, profile_id, name, icon, color, type, created_at, updated_at)
            VALUES ('\(cat.0)', '\(profileId)', '\(cat.1)', '\(cat.2)', '\(cat.3)', '\(cat.4)', '\(now)', '\(now)');
            """)
        }

        // Default Template
        let cols = #"{"date":"Buchungstag","valutaDate":"Wertstellung (Valuta)","type":"Vorgang","rawText":"Buchungstext","amount":"Umsatz in EUR"}"#
        exec("""
        INSERT OR IGNORE INTO bank_templates (id, profile_id, name, description, encoding, delimiter, header_identifier, columns, text_parser, date_format, created_at, updated_at)
        VALUES ('comdirect', '\(profileId)', 'comdirect Girokonto', 'Automatische Erkennung für comdirect CSV mit Windows-1252 & Textzerlegung', 'windows-1252', ';', 'Buchungstag', '\(cols)', 'comdirect', 'DD.MM.YYYY', '\(now)', '\(now)');
        """)
    }

    // MARK: - Helper Methods

    private func scalarInt(_ sql: String) -> Int {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return 0 }
        defer { sqlite3_finalize(stmt) }
        if sqlite3_step(stmt) == SQLITE_ROW {
            return Int(sqlite3_column_int(stmt, 0))
        }
        return 0
    }

    private func centsFromEuro(_ euro: Double) -> Int {
        return Int((euro * 100.0).rounded())
    }

    private func euroFromCents(_ cents: Int) -> Double {
        return Double(cents) / 100.0
    }

    private func nowISO() -> String {
        return ISO8601DateFormatter().string(from: Date())
    }

    private func markDirty(type: String, id: String, op: String = "UPSERT") {
        let now = nowISO()
        exec("""
        INSERT INTO sync_queue (record_type, record_id, operation, created_at)
        VALUES ('\(type)', '\(id)', '\(op)', '\(now)')
        ON CONFLICT(record_type, record_id) DO UPDATE SET operation = excluded.operation, created_at = excluded.created_at;
        """)
    }

    // MARK: - Public Profiles API

    public func getProfiles() -> [[String: Any]] {
        return queue.sync {
            var result = [[String: Any]]()
            let sql = "SELECT id, name, icon, color, is_default, pin_hash, created_at FROM profiles WHERE deleted_at IS NULL ORDER BY is_default DESC, name ASC;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                while sqlite3_step(stmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(stmt, 0))
                    let name = String(cString: sqlite3_column_text(stmt, 1))
                    let icon = String(cString: sqlite3_column_text(stmt, 2))
                    let color = String(cString: sqlite3_column_text(stmt, 3))
                    let isDefault = sqlite3_column_int(stmt, 4) != 0
                    let pinHash = sqlite3_column_text(stmt, 5) != nil ? String(cString: sqlite3_column_text(stmt, 5)) : nil
                    let createdAt = String(cString: sqlite3_column_text(stmt, 6))

                    result.append([
                        "id": id,
                        "name": name,
                        "icon": icon,
                        "color": color,
                        "isDefault": isDefault,
                        "hasPin": pinHash != nil && !pinHash!.isEmpty,
                        "createdAt": createdAt
                    ])
                }
            }
            sqlite3_finalize(stmt)
            return result
        }
    }

    public func createProfile(name: String, icon: String, color: String, pin: String?) -> [String: Any]? {
        return queue.sync {
            let id = name.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .replacingOccurrences(of: " ", with: "-") + "-" + UUID().uuidString.prefix(4).lowercased()
            let now = nowISO()
            let pinHash = pin != nil && !pin!.isEmpty ? SecurityManager.shared.hashPin(pin!) : nil

            var stmt: OpaquePointer?
            let sql = "INSERT INTO profiles (id, name, icon, color, is_default, pin_hash, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?);"
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (name as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (icon as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 4, (color as NSString).utf8String, -1, nil)
                if let ph = pinHash {
                    sqlite3_bind_text(stmt, 5, (ph as NSString).utf8String, -1, nil)
                } else {
                    sqlite3_bind_null(stmt, 5)
                }
                sqlite3_bind_text(stmt, 6, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 7, (now as NSString).utf8String, -1, nil)

                if sqlite3_step(stmt) == SQLITE_DONE {
                    sqlite3_finalize(stmt)
                    seedProfileDefaults(profileId: id)
                    markDirty(type: "Profile", id: id)
                    return [
                        "id": id,
                        "name": name,
                        "icon": icon,
                        "color": color,
                        "isDefault": false,
                        "hasPin": pinHash != nil
                    ]
                }
            }
            sqlite3_finalize(stmt)
            return nil
        }
    }

    public func updateProfile(id: String, name: String?, icon: String?, color: String?, pin: String?, removePin: Bool) -> Bool {
        return queue.sync {
            let now = nowISO()
            var pinHash: String? = nil
            if !removePin, let p = pin, !p.isEmpty {
                pinHash = SecurityManager.shared.hashPin(p)
            }

            var stmt: OpaquePointer?
            let sql = """
            UPDATE profiles
            SET name = COALESCE(?, name),
                icon = COALESCE(?, icon),
                color = COALESCE(?, color),
                pin_hash = CASE WHEN ? = 1 THEN NULL WHEN ? IS NOT NULL THEN ? ELSE pin_hash END,
                updated_at = ?
            WHERE id = ? AND deleted_at IS NULL;
            """
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                if let n = name { sqlite3_bind_text(stmt, 1, (n as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 1) }
                if let i = icon { sqlite3_bind_text(stmt, 2, (i as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 2) }
                if let c = color { sqlite3_bind_text(stmt, 3, (c as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 3) }
                sqlite3_bind_int(stmt, 4, removePin ? 1 : 0)
                if let ph = pinHash {
                    sqlite3_bind_text(stmt, 5, (ph as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(stmt, 6, (ph as NSString).utf8String, -1, nil)
                } else {
                    sqlite3_bind_null(stmt, 5)
                    sqlite3_bind_null(stmt, 6)
                }
                sqlite3_bind_text(stmt, 7, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 8, (id as NSString).utf8String, -1, nil)

                let ok = sqlite3_step(stmt) == SQLITE_DONE
                sqlite3_finalize(stmt)
                if ok {
                    markDirty(type: "Profile", id: id)
                }
                return ok
            }
            sqlite3_finalize(stmt)
            return false
        }
    }

    public func deleteProfile(id: String) -> Bool {
        return queue.sync {
            let total = scalarInt("SELECT count(*) FROM profiles WHERE deleted_at IS NULL;")
            if total <= 1 { return false }

            let now = nowISO()
            exec("UPDATE profiles SET deleted_at = '\(now)', updated_at = '\(now)' WHERE id = '\(id)';")
            markDirty(type: "Profile", id: id, op: "DELETE")
            return true
        }
    }

    public func unlockProfile(id: String, pin: String) -> Bool {
        return queue.sync {
            var stmt: OpaquePointer?
            let sql = "SELECT pin_hash FROM profiles WHERE id = ? AND deleted_at IS NULL;"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return false }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)

            if sqlite3_step(stmt) == SQLITE_ROW {
                guard let phPtr = sqlite3_column_text(stmt, 0) else { return true }
                let storedHash = String(cString: phPtr)
                if storedHash.isEmpty { return true }
                let checkHash = SecurityManager.shared.hashPin(pin)
                return storedHash == checkHash
            }
            return false
        }
    }

    // MARK: - Public Profile Data API

    public func getProfileData(profileId: String) -> [String: Any]? {
        return queue.sync {
            // Profile
            var profileDict: [String: Any]? = nil
            var pStmt: OpaquePointer?
            let pSql = "SELECT id, name, icon, color, is_default, pin_hash, created_at FROM profiles WHERE id = ? AND deleted_at IS NULL;"
            if sqlite3_prepare_v2(db, pSql, -1, &pStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(pStmt, 1, (profileId as NSString).utf8String, -1, nil)
                if sqlite3_step(pStmt) == SQLITE_ROW {
                    profileDict = [
                        "id": String(cString: sqlite3_column_text(pStmt, 0)),
                        "name": String(cString: sqlite3_column_text(pStmt, 1)),
                        "icon": String(cString: sqlite3_column_text(pStmt, 2)),
                        "color": String(cString: sqlite3_column_text(pStmt, 3)),
                        "isDefault": sqlite3_column_int(pStmt, 4) != 0,
                        "hasPin": sqlite3_column_text(pStmt, 5) != nil,
                        "createdAt": String(cString: sqlite3_column_text(pStmt, 6))
                    ]
                }
            }
            sqlite3_finalize(pStmt)
            guard let profile = profileDict else { return nil }

            // Accounts
            var accounts = [[String: Any]]()
            var aStmt: OpaquePointer?
            let aSql = "SELECT id, name, iban, initial_balance_cents, initial_balance_date, checkpoint_balance_cents, checkpoint_date FROM accounts WHERE profile_id = ? AND deleted_at IS NULL;"
            if sqlite3_prepare_v2(db, aSql, -1, &aStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(aStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(aStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(aStmt, 0))
                    let name = String(cString: sqlite3_column_text(aStmt, 1))
                    let iban = sqlite3_column_text(aStmt, 2) != nil ? String(cString: sqlite3_column_text(aStmt, 2)) : nil
                    let initCents = Int(sqlite3_column_int64(aStmt, 3))
                    let initDate = String(cString: sqlite3_column_text(aStmt, 4))
                    var chkBal: Double? = nil
                    if sqlite3_column_type(aStmt, 5) != SQLITE_NULL {
                        chkBal = euroFromCents(Int(sqlite3_column_int64(aStmt, 5)))
                    }
                    let chkDate = sqlite3_column_text(aStmt, 6) != nil ? String(cString: sqlite3_column_text(aStmt, 6)) : nil

                    var accDict: [String: Any] = [
                        "id": id,
                        "name": name,
                        "initialBalance": euroFromCents(initCents),
                        "initialBalanceDate": initDate
                    ]
                    if let ib = iban { accDict["iban"] = ib }
                    if let cb = chkBal { accDict["checkpointBalance"] = cb }
                    if let cd = chkDate { accDict["checkpointDate"] = cd }
                    accounts.append(accDict)
                }
            }
            sqlite3_finalize(aStmt)

            // Categories
            var categories = [[String: Any]]()
            var cStmt: OpaquePointer?
            let cSql = "SELECT id, name, icon, color, type, budget_cents FROM categories WHERE profile_id = ? AND deleted_at IS NULL;"
            if sqlite3_prepare_v2(db, cSql, -1, &cStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(cStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(cStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(cStmt, 0))
                    let name = String(cString: sqlite3_column_text(cStmt, 1))
                    let icon = String(cString: sqlite3_column_text(cStmt, 2))
                    let color = String(cString: sqlite3_column_text(cStmt, 3))
                    let type = String(cString: sqlite3_column_text(cStmt, 4))
                    var budget: Double? = nil
                    if sqlite3_column_type(cStmt, 5) != SQLITE_NULL {
                        budget = euroFromCents(Int(sqlite3_column_int64(cStmt, 5)))
                    }

                    var catDict: [String: Any] = [
                        "id": id,
                        "name": name,
                        "icon": icon,
                        "color": color,
                        "type": type
                    ]
                    if let b = budget { catDict["budget"] = b }
                    categories.append(catDict)
                }
            }
            sqlite3_finalize(cStmt)

            // Rules
            var rules = [[String: Any]]()
            var rStmt: OpaquePointer?
            let rSql = "SELECT id, name, priority, conditions, apply_category, enabled FROM rules WHERE profile_id = ? AND deleted_at IS NULL ORDER BY priority ASC;"
            if sqlite3_prepare_v2(db, rSql, -1, &rStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(rStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(rStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(rStmt, 0))
                    let name = String(cString: sqlite3_column_text(rStmt, 1))
                    let priority = Int(sqlite3_column_int(rStmt, 2))
                    let conditionsJson = String(cString: sqlite3_column_text(rStmt, 3))
                    let applyCat = String(cString: sqlite3_column_text(rStmt, 4))
                    let enabled = sqlite3_column_int(rStmt, 5) != 0

                    let conditionsObj = (try? JSONSerialization.jsonObject(with: Data(conditionsJson.utf8))) ?? []

                    rules.append([
                        "id": id,
                        "name": name,
                        "priority": priority,
                        "conditions": conditionsObj,
                        "applyCategory": applyCat,
                        "enabled": enabled
                    ])
                }
            }
            sqlite3_finalize(rStmt)

            // Transactions
            var transactions = [[String: Any]]()
            var tStmt: OpaquePointer?
            let tSql = """
            SELECT id, legacy_id, date, valuta_date, amount_cents, currency, payee, purpose, raw_text, type, category, subcategory, account, status, source_hash, imported_at, is_manual
            FROM transactions
            WHERE profile_id = ? AND deleted_at IS NULL
            ORDER BY date DESC;
            """
            if sqlite3_prepare_v2(db, tSql, -1, &tStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(tStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(tStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(tStmt, 0))
                    let date = String(cString: sqlite3_column_text(tStmt, 2))
                    let valutaDate = sqlite3_column_text(tStmt, 3) != nil ? String(cString: sqlite3_column_text(tStmt, 3)) : nil
                    let amountCents = Int(sqlite3_column_int64(tStmt, 4))
                    let currency = String(cString: sqlite3_column_text(tStmt, 5))
                    let payee = String(cString: sqlite3_column_text(tStmt, 6))
                    let purpose = String(cString: sqlite3_column_text(tStmt, 7))
                    let rawText = String(cString: sqlite3_column_text(tStmt, 8))
                    let type = String(cString: sqlite3_column_text(tStmt, 9))
                    let category = String(cString: sqlite3_column_text(tStmt, 10))
                    let subcategory = sqlite3_column_text(tStmt, 11) != nil ? String(cString: sqlite3_column_text(tStmt, 11)) : nil
                    let account = String(cString: sqlite3_column_text(tStmt, 12))
                    let status = String(cString: sqlite3_column_text(tStmt, 13))
                    let sourceHash = String(cString: sqlite3_column_text(tStmt, 14))
                    let importedAt = String(cString: sqlite3_column_text(tStmt, 15))
                    let isManual = sqlite3_column_int(tStmt, 16) != 0

                    var txDict: [String: Any] = [
                        "id": id,
                        "date": date,
                        "amount": euroFromCents(amountCents),
                        "currency": currency,
                        "payee": payee,
                        "purpose": purpose,
                        "rawText": rawText,
                        "type": type,
                        "category": category,
                        "account": account,
                        "status": status,
                        "sourceHash": sourceHash,
                        "importedAt": importedAt,
                        "isManual": isManual
                    ]
                    if let vd = valutaDate { txDict["valutaDate"] = vd }
                    if let sc = subcategory { txDict["subcategory"] = sc }
                    transactions.append(txDict)
                }
            }
            sqlite3_finalize(tStmt)

            // Bank Templates
            var templates = [[String: Any]]()
            var btStmt: OpaquePointer?
            let btSql = "SELECT id, name, description, encoding, delimiter, header_identifier, columns, text_parser, date_format FROM bank_templates WHERE profile_id = ? AND deleted_at IS NULL;"
            if sqlite3_prepare_v2(db, btSql, -1, &btStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(btStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(btStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(btStmt, 0))
                    let name = String(cString: sqlite3_column_text(btStmt, 1))
                    let desc = String(cString: sqlite3_column_text(btStmt, 2))
                    let enc = String(cString: sqlite3_column_text(btStmt, 3))
                    let delim = String(cString: sqlite3_column_text(btStmt, 4))
                    let headerId = String(cString: sqlite3_column_text(btStmt, 5))
                    let colsJson = String(cString: sqlite3_column_text(btStmt, 6))
                    let textParser = String(cString: sqlite3_column_text(btStmt, 7))
                    let dateFormat = String(cString: sqlite3_column_text(btStmt, 8))

                    let colsObj = (try? JSONSerialization.jsonObject(with: Data(colsJson.utf8))) ?? [:]

                    templates.append([
                        "id": id,
                        "name": name,
                        "description": desc,
                        "encoding": enc,
                        "delimiter": delim,
                        "headerIdentifier": headerId,
                        "columns": colsObj,
                        "textParser": textParser,
                        "dateFormat": dateFormat
                    ])
                }
            }
            sqlite3_finalize(btStmt)

            return [
                "profile": profile,
                "accounts": accounts,
                "categories": categories,
                "rules": rules,
                "transactions": transactions,
                "bankTemplates": templates
            ]
        }
    }

    // MARK: - Batch Import & Transactions

    public func batchImportTransactions(profileId: String, transactions: [[String: Any]], accountCheckpoint: [String: Any]?) -> [String: Int] {
        return queue.sync {
            var inserted = 0
            var updated = 0
            var duplicates = 0

            exec("BEGIN TRANSACTION;")

            // 1. Account Checkpoint
            if let cp = accountCheckpoint,
               let newBalance = cp["newBalance"] as? Double {
                let newBalCents = centsFromEuro(newBalance)
                let endDate = cp["endDate"] as? String ?? cp["maxDate"] as? String
                let iban = cp["iban"] as? String

                var cpDate = endDate
                if cpDate?.isEmpty ?? true {
                    let dates = transactions.compactMap { $0["date"] as? String }
                    cpDate = dates.max()
                }
                let resolvedCpDate = (cpDate?.isEmpty ?? true)
                    ? ISO8601DateFormatter().string(from: Date()).prefix(10).description
                    : cpDate!

                let now = nowISO()
                var cpStmt: OpaquePointer?
                let cpSql = """
                UPDATE accounts
                SET checkpoint_balance_cents = ?,
                    checkpoint_date = ?,
                    iban = COALESCE(?, iban),
                    updated_at = ?
                WHERE id = 'comdirect' AND profile_id = ? AND deleted_at IS NULL;
                """
                if sqlite3_prepare_v2(db, cpSql, -1, &cpStmt, nil) == SQLITE_OK {
                    sqlite3_bind_int64(cpStmt, 1, sqlite3_int64(newBalCents))
                    sqlite3_bind_text(cpStmt, 2, (resolvedCpDate as NSString).utf8String, -1, nil)
                    if let ib = iban { sqlite3_bind_text(cpStmt, 3, (ib as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(cpStmt, 3) }
                    sqlite3_bind_text(cpStmt, 4, (now as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(cpStmt, 5, (profileId as NSString).utf8String, -1, nil)
                    sqlite3_step(cpStmt)
                }
                sqlite3_finalize(cpStmt)
                markDirty(type: "Account", id: "comdirect")
            }

            // 2. Fetch existing transactions to handle pending promotion & duplicate skipping
            var existingBookedHashes = Set<String>()
            var pendingMap = [String: [String]]() // key -> [id]

            var exStmt: OpaquePointer?
            let exSql = "SELECT id, date, amount_cents, payee, account, status, source_hash FROM transactions WHERE profile_id = ? AND deleted_at IS NULL;"
            if sqlite3_prepare_v2(db, exSql, -1, &exStmt, nil) == SQLITE_OK {
                sqlite3_bind_text(exStmt, 1, (profileId as NSString).utf8String, -1, nil)
                while sqlite3_step(exStmt) == SQLITE_ROW {
                    let id = String(cString: sqlite3_column_text(exStmt, 0))
                    let date = String(cString: sqlite3_column_text(exStmt, 1))
                    let amountCents = Int(sqlite3_column_int64(exStmt, 2))
                    let payee = String(cString: sqlite3_column_text(exStmt, 3))
                    let account = String(cString: sqlite3_column_text(exStmt, 4))
                    let status = String(cString: sqlite3_column_text(exStmt, 5))
                    let hash = String(cString: sqlite3_column_text(exStmt, 6))

                    if status == "booked" {
                        existingBookedHashes.insert(hash)
                    } else if status == "pending" {
                        let euroStr = String(format: "%.2f", euroFromCents(amountCents))
                        let key = "\(date)|\(euroStr)|\(payee.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())|\(account)"
                        var list = pendingMap[key] ?? []
                        list.append(id)
                        pendingMap[key] = list
                    }
                }
            }
            sqlite3_finalize(exStmt)

            // Prepared statements for loop
            var insStmt: OpaquePointer?
            let insSql = """
            INSERT INTO transactions (
                id, profile_id, date, valuta_date, amount_cents, currency, payee, purpose, raw_text, type, category, account, status, source_hash, imported_at, is_manual, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """
            sqlite3_prepare_v2(db, insSql, -1, &insStmt, nil)

            var updStmt: OpaquePointer?
            let updSql = "UPDATE transactions SET status = 'booked', raw_text = ?, type = ?, source_hash = ?, updated_at = ? WHERE id = ?;"
            sqlite3_prepare_v2(db, updSql, -1, &updStmt, nil)

            let now = nowISO()

            for t in transactions {
                guard let date = t["date"] as? String,
                      let amount = t["amount"] as? Double,
                      let hash = t["sourceHash"] as? String else { continue }

                if existingBookedHashes.contains(hash) {
                    duplicates += 1
                    continue
                }

                let accountName = (t["account"] as? String) ?? "comdirect Girokonto"
                let payee = (t["payee"] as? String) ?? "Unbekannt"
                let status = (t["status"] as? String) ?? "booked"
                let euroStr = String(format: "%.2f", amount)
                let pendingKey = "\(date)|\(euroStr)|\(payee.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())|\(accountName)"

                if var list = pendingMap[pendingKey], !list.isEmpty, status == "booked" {
                    let targetId = list.removeFirst()
                    pendingMap[pendingKey] = list

                    sqlite3_reset(updStmt)
                    sqlite3_bind_text(updStmt, 1, ((t["rawText"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(updStmt, 2, ((t["type"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(updStmt, 3, (hash as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(updStmt, 4, (now as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(updStmt, 5, (targetId as NSString).utf8String, -1, nil)
                    sqlite3_step(updStmt)

                    existingBookedHashes.insert(hash)
                    markDirty(type: "Transaction", id: targetId)
                    updated += 1
                } else {
                    let txId = (t["id"] as? String) ?? UUID().uuidString
                    let amountCents = centsFromEuro(amount)

                    sqlite3_reset(insStmt)
                    sqlite3_bind_text(insStmt, 1, (txId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 2, (profileId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 3, (date as NSString).utf8String, -1, nil)
                    if let vd = t["valutaDate"] as? String { sqlite3_bind_text(insStmt, 4, (vd as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(insStmt, 4) }
                    sqlite3_bind_int64(insStmt, 5, sqlite3_int64(amountCents))
                    sqlite3_bind_text(insStmt, 6, ((t["currency"] as? String ?? "EUR") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 7, (payee as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 8, ((t["purpose"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 9, ((t["rawText"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 10, ((t["type"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 11, ((t["category"] as? String ?? "sonstiges") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 12, (accountName as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 13, (status as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 14, (hash as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 15, ((t["importedAt"] as? String ?? now) as NSString).utf8String, -1, nil)
                    sqlite3_bind_int(insStmt, 16, (t["isManual"] as? Bool == true) ? 1 : 0)
                    sqlite3_bind_text(insStmt, 17, (now as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 18, (now as NSString).utf8String, -1, nil)

                    if sqlite3_step(insStmt) == SQLITE_DONE {
                        existingBookedHashes.insert(hash)
                        markDirty(type: "Transaction", id: txId)
                        inserted += 1
                    }
                }
            }

            sqlite3_finalize(insStmt)
            sqlite3_finalize(updStmt)
            exec("COMMIT;")

            return ["inserted": inserted, "updated": updated, "duplicates": duplicates]
        }
    }

    public func createManualTransaction(profileId: String, transaction: [String: Any]) -> String? {
        return queue.sync {
            let txId = UUID().uuidString
            let now = nowISO()
            let amount = (transaction["amount"] as? Double) ?? 0.0
            let amountCents = centsFromEuro(amount)
            let date = (transaction["date"] as? String) ?? now.prefix(10).description
            let hash = (transaction["sourceHash"] as? String) ?? "man_\(UUID().uuidString)"

            var stmt: OpaquePointer?
            let sql = """
            INSERT INTO transactions (
                id, profile_id, date, valuta_date, amount_cents, currency, payee, purpose, raw_text, type, category, account, status, source_hash, imported_at, is_manual, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?);
            """
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (txId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (date as NSString).utf8String, -1, nil)
                if let vd = transaction["valutaDate"] as? String { sqlite3_bind_text(stmt, 4, (vd as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 4) }
                sqlite3_bind_int64(stmt, 5, sqlite3_int64(amountCents))
                sqlite3_bind_text(stmt, 6, ((transaction["currency"] as? String ?? "EUR") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 7, ((transaction["payee"] as? String ?? "Manuell") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 8, ((transaction["purpose"] as? String ?? "") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 9, ((transaction["rawText"] as? String ?? "Manuelle Buchung") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 10, ((transaction["type"] as? String ?? "Barzahlung") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 11, ((transaction["category"] as? String ?? "sonstiges") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 12, ((transaction["account"] as? String ?? "Girokonto") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 13, ((transaction["status"] as? String ?? "booked") as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 14, (hash as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 15, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 16, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 17, (now as NSString).utf8String, -1, nil)

                if sqlite3_step(stmt) == SQLITE_DONE {
                    sqlite3_finalize(stmt)
                    markDirty(type: "Transaction", id: txId)
                    return txId
                }
            }
            sqlite3_finalize(stmt)
            return nil
        }
    }

    public func updateTransaction(id: String, transaction: [String: Any]) -> Bool {
        return queue.sync {
            let now = nowISO()
            var fields = [String]()
            var args = [Any]()

            if let date = transaction["date"] as? String {
                fields.append("date = ?")
                args.append(date)
            }
            if let amount = transaction["amount"] as? Double {
                fields.append("amount_cents = ?")
                args.append(centsFromEuro(amount))
            }
            if let payee = transaction["payee"] as? String {
                fields.append("payee = ?")
                args.append(payee)
            }
            if let purpose = transaction["purpose"] as? String {
                fields.append("purpose = ?")
                args.append(purpose)
            }
            if let category = transaction["category"] as? String {
                fields.append("category = ?")
                args.append(category)
            }
            if let account = transaction["account"] as? String {
                fields.append("account = ?")
                args.append(account)
            }
            if let status = transaction["status"] as? String {
                fields.append("status = ?")
                args.append(status)
            }

            guard !fields.isEmpty else { return true }
            fields.append("updated_at = ?")
            args.append(now)

            let sql = "UPDATE transactions SET \(fields.joined(separator: ", ")) WHERE id = ? AND deleted_at IS NULL;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                var idx: Int32 = 1
                for arg in args {
                    if let str = arg as? String {
                        sqlite3_bind_text(stmt, idx, (str as NSString).utf8String, -1, nil)
                    } else if let intVal = arg as? Int {
                        sqlite3_bind_int64(stmt, idx, sqlite3_int64(intVal))
                    }
                    idx += 1
                }
                sqlite3_bind_text(stmt, idx, (id as NSString).utf8String, -1, nil)

                let ok = sqlite3_step(stmt) == SQLITE_DONE
                sqlite3_finalize(stmt)
                if ok {
                    markDirty(type: "Transaction", id: id)
                }
                return ok
            }
            sqlite3_finalize(stmt)
            return false
        }
    }

    public func deleteTransaction(id: String) -> Bool {
        return queue.sync {
            let now = nowISO()
            exec("UPDATE transactions SET deleted_at = '\(now)', updated_at = '\(now)' WHERE id = '\(id)';")
            markDirty(type: "Transaction", id: id, op: "DELETE")
            return true
        }
    }

    // MARK: - Account Settings

    public func updateAccountSettings(profileId: String, id: String, initialBalance: Double?, initialBalanceDate: String?, checkpointBalance: Double?, checkpointDate: String?) -> Bool {
        return queue.sync {
            let now = nowISO()
            var fields = ["updated_at = ?"]
            var args: [Any] = [now]

            if let ib = initialBalance {
                fields.append("initial_balance_cents = ?")
                args.append(centsFromEuro(ib))
            }
            if let ibd = initialBalanceDate {
                fields.append("initial_balance_date = ?")
                args.append(ibd)
            }
            if let cb = checkpointBalance {
                fields.append("checkpoint_balance_cents = ?")
                args.append(centsFromEuro(cb))
            }
            if let cd = checkpointDate {
                fields.append("checkpoint_date = ?")
                args.append(cd)
            }

            let sql = "UPDATE accounts SET \(fields.joined(separator: ", ")) WHERE id = ? AND profile_id = ? AND deleted_at IS NULL;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                var idx: Int32 = 1
                for arg in args {
                    if let str = arg as? String {
                        sqlite3_bind_text(stmt, idx, (str as NSString).utf8String, -1, nil)
                    } else if let intVal = arg as? Int {
                        sqlite3_bind_int64(stmt, idx, sqlite3_int64(intVal))
                    }
                    idx += 1
                }
                sqlite3_bind_text(stmt, idx, (id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, idx + 1, (profileId as NSString).utf8String, -1, nil)

                let ok = sqlite3_step(stmt) == SQLITE_DONE
                sqlite3_finalize(stmt)
                if ok {
                    markDirty(type: "Account", id: id)
                }
                return ok
            }
            sqlite3_finalize(stmt)
            return false
        }
    }

    // MARK: - Categories & Rules

    public func createCategory(profileId: String, category: [String: Any]) -> [String: Any]? {
        return queue.sync {
            let id = (category["id"] as? String) ?? UUID().uuidString.prefix(8).lowercased().description
            let name = (category["name"] as? String) ?? "Neue Kategorie"
            let icon = (category["icon"] as? String) ?? "Package"
            let color = (category["color"] as? String) ?? "#8E8E93"
            let type = (category["type"] as? String) ?? "expense"
            let budget = category["budget"] as? Double
            let budgetCents = budget != nil ? centsFromEuro(budget!) : nil
            let now = nowISO()

            var stmt: OpaquePointer?
            let sql = """
            INSERT INTO categories (id, profile_id, name, icon, color, type, budget_cents, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, profile_id) DO UPDATE SET name = excluded.name, icon = excluded.icon, color = excluded.color, type = excluded.type, budget_cents = excluded.budget_cents, updated_at = excluded.updated_at, deleted_at = NULL;
            """
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 4, (icon as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 5, (color as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 6, (type as NSString).utf8String, -1, nil)
                if let bc = budgetCents { sqlite3_bind_int64(stmt, 7, sqlite3_int64(bc)) } else { sqlite3_bind_null(stmt, 7) }
                sqlite3_bind_text(stmt, 8, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 9, (now as NSString).utf8String, -1, nil)

                if sqlite3_step(stmt) == SQLITE_DONE {
                    sqlite3_finalize(stmt)
                    markDirty(type: "Category", id: id)
                    return [
                        "id": id,
                        "name": name,
                        "icon": icon,
                        "color": color,
                        "type": type,
                        "budget": budget as Any
                    ]
                }
            }
            sqlite3_finalize(stmt)
            return nil
        }
    }

    public func deleteCategory(profileId: String, id: String) -> Bool {
        return queue.sync {
            let now = nowISO()
            exec("UPDATE categories SET deleted_at = '\(now)', updated_at = '\(now)' WHERE id = '\(id)' AND profile_id = '\(profileId)';")
            // Re-assign transactions belonging to this category to 'sonstiges'
            exec("UPDATE transactions SET category = 'sonstiges', updated_at = '\(now)' WHERE category = '\(id)' AND profile_id = '\(profileId)' AND deleted_at IS NULL;")
            markDirty(type: "Category", id: id, op: "DELETE")
            return true
        }
    }

    public func createRule(profileId: String, rule: [String: Any]) -> Bool {
        return queue.sync {
            let id = (rule["id"] as? String) ?? UUID().uuidString
            let name = (rule["name"] as? String) ?? "Neue Regel"
            let priority = (rule["priority"] as? Int) ?? 20
            let applyCat = (rule["applyCategory"] as? String) ?? "sonstiges"
            let enabled = (rule["enabled"] as? Bool) ?? true
            let condObj = rule["conditions"] ?? []
            let condData = (try? JSONSerialization.data(withJSONObject: condObj)) ?? Data("[]".utf8)
            let condJson = String(data: condData, encoding: .utf8) ?? "[]"
            let now = nowISO()

            var stmt: OpaquePointer?
            let sql = """
            INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, profile_id) DO UPDATE SET name = excluded.name, priority = excluded.priority, conditions = excluded.conditions, apply_category = excluded.apply_category, enabled = excluded.enabled, updated_at = excluded.updated_at, deleted_at = NULL;
            """
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                sqlite3_bind_int(stmt, 4, Int32(priority))
                sqlite3_bind_text(stmt, 5, (condJson as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 6, (applyCat as NSString).utf8String, -1, nil)
                sqlite3_bind_int(stmt, 7, enabled ? 1 : 0)
                sqlite3_bind_text(stmt, 8, (now as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 9, (now as NSString).utf8String, -1, nil)

                let ok = sqlite3_step(stmt) == SQLITE_DONE
                sqlite3_finalize(stmt)
                if ok {
                    markDirty(type: "Rule", id: id)
                }
                return ok
            }
            sqlite3_finalize(stmt)
            return false
        }
    }

    public func deleteRule(profileId: String, id: String) -> Bool {
        return queue.sync {
            let now = nowISO()
            exec("UPDATE rules SET deleted_at = '\(now)', updated_at = '\(now)' WHERE id = '\(id)' AND profile_id = '\(profileId)';")
            markDirty(type: "Rule", id: id, op: "DELETE")
            return true
        }
    }

    public func loadStandardRules(profileId: String, standardRulesJson: String) -> [String: Int] {
        return queue.sync {
            guard let data = standardRulesJson.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rulesList = obj["rules"] as? [[String: Any]] else {
                return ["inserted": 0, "updated": 0]
            }

            var inserted = 0
            var updated = 0
            let now = nowISO()

            for r in rulesList {
                guard let id = r["id"] as? String,
                      let name = r["name"] as? String,
                      let priority = r["priority"] as? Int,
                      let applyCat = r["applyCategory"] as? String else { continue }

                let conditions = r["conditions"] ?? []
                let condData = (try? JSONSerialization.data(withJSONObject: conditions)) ?? Data("[]".utf8)
                let condJson = String(data: condData, encoding: .utf8) ?? "[]"

                let exists = scalarInt("SELECT count(*) FROM rules WHERE id = '\(id)' AND profile_id = '\(profileId)' AND deleted_at IS NULL;")
                if exists == 0 {
                    exec("""
                    INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled, created_at, updated_at)
                    VALUES ('\(id)', '\(profileId)', '\(name)', \(priority), '\(condJson)', '\(applyCat)', 1, '\(now)', '\(now)');
                    """)
                    markDirty(type: "Rule", id: id)
                    inserted += 1
                } else {
                    // Update definition
                    exec("""
                    UPDATE rules SET name = '\(name)', priority = \(priority), conditions = '\(condJson)', apply_category = '\(applyCat)', updated_at = '\(now)'
                    WHERE id = '\(id)' AND profile_id = '\(profileId)';
                    """)
                    markDirty(type: "Rule", id: id)
                    updated += 1
                }
            }
            return ["inserted": inserted, "updated": updated]
        }
    }

    // MARK: - Restore & Reset

    public func importProfileBackup(profileId: String, payload: [String: Any], mode: String = "replace") -> Bool {
        return queue.sync {
            exec("BEGIN TRANSACTION;")

            let now = nowISO()

            if mode == "replace" {
                // Delete active records for this profile
                exec("UPDATE transactions SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
                exec("UPDATE rules SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
                exec("UPDATE categories SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
                exec("UPDATE bank_templates SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
            }

            // Import Accounts
            if let accounts = payload["accounts"] as? [[String: Any]] {
                for a in accounts {
                    let id = (a["id"] as? String) ?? "comdirect"
                    let name = (a["name"] as? String) ?? "Girokonto"
                    let iban = a["iban"] as? String
                    let initBal = (a["initialBalance"] as? Double) ?? 0.0
                    let initCents = centsFromEuro(initBal)
                    let initDate = (a["initialBalanceDate"] as? String) ?? "2026-01-01"
                    let chkBal = a["checkpointBalance"] as? Double
                    let chkCents = chkBal != nil ? centsFromEuro(chkBal!) : nil
                    let chkDate = a["checkpointDate"] as? String

                    var stmt: OpaquePointer?
                    let sql = """
                    INSERT INTO accounts (id, profile_id, name, iban, initial_balance_cents, initial_balance_date, checkpoint_balance_cents, checkpoint_date, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, profile_id) DO UPDATE SET
                        name = excluded.name,
                        iban = excluded.iban,
                        initial_balance_cents = excluded.initial_balance_cents,
                        initial_balance_date = excluded.initial_balance_date,
                        checkpoint_balance_cents = excluded.checkpoint_balance_cents,
                        checkpoint_date = excluded.checkpoint_date,
                        updated_at = excluded.updated_at,
                        deleted_at = NULL;
                    """
                    if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                        sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                        if let ib = iban { sqlite3_bind_text(stmt, 4, (ib as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 4) }
                        sqlite3_bind_int64(stmt, 5, sqlite3_int64(initCents))
                        sqlite3_bind_text(stmt, 6, (initDate as NSString).utf8String, -1, nil)
                        if let cc = chkCents { sqlite3_bind_int64(stmt, 7, sqlite3_int64(cc)) } else { sqlite3_bind_null(stmt, 7) }
                        if let cd = chkDate { sqlite3_bind_text(stmt, 8, (cd as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(stmt, 8) }
                        sqlite3_bind_text(stmt, 9, (now as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 10, (now as NSString).utf8String, -1, nil)
                        sqlite3_step(stmt)
                    }
                    sqlite3_finalize(stmt)
                    markDirty(type: "Account", id: id)
                }
            }

            // Import Categories
            if let categories = payload["categories"] as? [[String: Any]] {
                for c in categories {
                    let id = (c["id"] as? String) ?? UUID().uuidString
                    let name = (c["name"] as? String) ?? "Kategorie"
                    let icon = (c["icon"] as? String) ?? "Package"
                    let color = (c["color"] as? String) ?? "#8E8E93"
                    let type = (c["type"] as? String) ?? "expense"
                    let budget = c["budget"] as? Double
                    let budgetCents = budget != nil ? centsFromEuro(budget!) : nil

                    var stmt: OpaquePointer?
                    let sql = """
                    INSERT INTO categories (id, profile_id, name, icon, color, type, budget_cents, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, profile_id) DO UPDATE SET
                        name = excluded.name,
                        icon = excluded.icon,
                        color = excluded.color,
                        type = excluded.type,
                        budget_cents = excluded.budget_cents,
                        updated_at = excluded.updated_at,
                        deleted_at = NULL;
                    """
                    if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                        sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 4, (icon as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 5, (color as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 6, (type as NSString).utf8String, -1, nil)
                        if let bc = budgetCents { sqlite3_bind_int64(stmt, 7, sqlite3_int64(bc)) } else { sqlite3_bind_null(stmt, 7) }
                        sqlite3_bind_text(stmt, 8, (now as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 9, (now as NSString).utf8String, -1, nil)
                        sqlite3_step(stmt)
                    }
                    sqlite3_finalize(stmt)
                    markDirty(type: "Category", id: id)
                }
            }

            // Import Rules
            if let rules = payload["rules"] as? [[String: Any]] {
                for r in rules {
                    let id = (r["id"] as? String) ?? UUID().uuidString
                    let name = (r["name"] as? String) ?? "Regel"
                    let priority = (r["priority"] as? Int) ?? 20
                    let applyCat = (r["applyCategory"] as? String) ?? "sonstiges"
                    let enabled = (r["enabled"] as? Bool) ?? true
                    let conditions = r["conditions"] ?? []
                    let condData = (try? JSONSerialization.data(withJSONObject: conditions)) ?? Data("[]".utf8)
                    let condJson = String(data: condData, encoding: .utf8) ?? "[]"

                    var stmt: OpaquePointer?
                    let sql = """
                    INSERT INTO rules (id, profile_id, name, priority, conditions, apply_category, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, profile_id) DO UPDATE SET
                        name = excluded.name,
                        priority = excluded.priority,
                        conditions = excluded.conditions,
                        apply_category = excluded.apply_category,
                        enabled = excluded.enabled,
                        updated_at = excluded.updated_at,
                        deleted_at = NULL;
                    """
                    if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                        sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                        sqlite3_bind_int(stmt, 4, Int32(priority))
                        sqlite3_bind_text(stmt, 5, (condJson as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 6, (applyCat as NSString).utf8String, -1, nil)
                        sqlite3_bind_int(stmt, 7, enabled ? 1 : 0)
                        sqlite3_bind_text(stmt, 8, (now as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 9, (now as NSString).utf8String, -1, nil)
                        sqlite3_step(stmt)
                    }
                    sqlite3_finalize(stmt)
                    markDirty(type: "Rule", id: id)
                }
            }

            // Import Bank Templates
            if let templates = payload["bankTemplates"] as? [[String: Any]] {
                for bt in templates {
                    let id = (bt["id"] as? String) ?? "comdirect"
                    let name = (bt["name"] as? String) ?? "Template"
                    let desc = (bt["description"] as? String) ?? ""
                    let enc = (bt["encoding"] as? String) ?? "windows-1252"
                    let delim = (bt["delimiter"] as? String) ?? ";"
                    let headerId = (bt["headerIdentifier"] as? String) ?? "Buchungstag"
                    let cols = bt["columns"] ?? [:]
                    let colsData = (try? JSONSerialization.data(withJSONObject: cols)) ?? Data("{}".utf8)
                    let colsJson = String(data: colsData, encoding: .utf8) ?? "{}"
                    let textParser = (bt["textParser"] as? String) ?? "comdirect"
                    let dateFormat = (bt["dateFormat"] as? String) ?? "DD.MM.YYYY"

                    var stmt: OpaquePointer?
                    let sql = """
                    INSERT INTO bank_templates (id, profile_id, name, description, encoding, delimiter, header_identifier, columns, text_parser, date_format, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id, profile_id) DO UPDATE SET
                        name = excluded.name,
                        description = excluded.description,
                        encoding = excluded.encoding,
                        delimiter = excluded.delimiter,
                        header_identifier = excluded.header_identifier,
                        columns = excluded.columns,
                        text_parser = excluded.text_parser,
                        date_format = excluded.date_format,
                        updated_at = excluded.updated_at,
                        deleted_at = NULL;
                    """
                    if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                        sqlite3_bind_text(stmt, 1, (id as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 2, (profileId as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 3, (name as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 4, (desc as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 5, (enc as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 6, (delim as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 7, (headerId as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 8, (colsJson as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 9, (textParser as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 10, (dateFormat as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 11, (now as NSString).utf8String, -1, nil)
                        sqlite3_bind_text(stmt, 12, (now as NSString).utf8String, -1, nil)
                        sqlite3_step(stmt)
                    }
                    sqlite3_finalize(stmt)
                    markDirty(type: "BankTemplate", id: id)
                }
            }

            // Import Transactions
            if let txs = payload["transactions"] as? [[String: Any]] {
                var insStmt: OpaquePointer?
                let insSql = """
                INSERT INTO transactions (
                    id, profile_id, date, valuta_date, amount_cents, currency, payee, purpose, raw_text, type, category, account, status, source_hash, imported_at, is_manual, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    date = excluded.date,
                    valuta_date = excluded.valuta_date,
                    amount_cents = excluded.amount_cents,
                    currency = excluded.currency,
                    payee = excluded.payee,
                    purpose = excluded.purpose,
                    raw_text = excluded.raw_text,
                    type = excluded.type,
                    category = excluded.category,
                    account = excluded.account,
                    status = excluded.status,
                    source_hash = excluded.source_hash,
                    updated_at = excluded.updated_at,
                    deleted_at = NULL;
                """
                sqlite3_prepare_v2(db, insSql, -1, &insStmt, nil)

                for t in txs {
                    let txId = (t["id"] as? String) ?? UUID().uuidString
                    let date = (t["date"] as? String) ?? now.prefix(10).description
                    let amount = (t["amount"] as? Double) ?? 0.0
                    let amountCents = centsFromEuro(amount)
                    let hash = (t["sourceHash"] as? String) ?? "tx_\(UUID().uuidString)"

                    sqlite3_reset(insStmt)
                    sqlite3_bind_text(insStmt, 1, (txId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 2, (profileId as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 3, (date as NSString).utf8String, -1, nil)
                    if let vd = t["valutaDate"] as? String { sqlite3_bind_text(insStmt, 4, (vd as NSString).utf8String, -1, nil) } else { sqlite3_bind_null(insStmt, 4) }
                    sqlite3_bind_int64(insStmt, 5, sqlite3_int64(amountCents))
                    sqlite3_bind_text(insStmt, 6, ((t["currency"] as? String ?? "EUR") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 7, ((t["payee"] as? String ?? "Unbekannt") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 8, ((t["purpose"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 9, ((t["rawText"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 10, ((t["type"] as? String ?? "") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 11, ((t["category"] as? String ?? "sonstiges") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 12, ((t["account"] as? String ?? "comdirect Girokonto") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 13, ((t["status"] as? String ?? "booked") as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 14, (hash as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 15, ((t["importedAt"] as? String ?? now) as NSString).utf8String, -1, nil)
                    sqlite3_bind_int(insStmt, 16, (t["isManual"] as? Bool == true) ? 1 : 0)
                    sqlite3_bind_text(insStmt, 17, (now as NSString).utf8String, -1, nil)
                    sqlite3_bind_text(insStmt, 18, (now as NSString).utf8String, -1, nil)
                    sqlite3_step(insStmt)

                    markDirty(type: "Transaction", id: txId)
                }
                sqlite3_finalize(insStmt)
            }

            exec("COMMIT;")
            return true
        }
    }

    public func resetProfileData(profileId: String) -> Bool {
        return queue.sync {
            exec("BEGIN TRANSACTION;")
            let now = nowISO()
            exec("UPDATE transactions SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
            exec("UPDATE rules SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
            exec("UPDATE categories SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
            exec("UPDATE bank_templates SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")
            exec("UPDATE accounts SET deleted_at = '\(now)', updated_at = '\(now)' WHERE profile_id = '\(profileId)' AND deleted_at IS NULL;")

            seedProfileDefaults(profileId: profileId)
            exec("COMMIT;")
            return true
        }
    }

    // MARK: - CloudKit Sync Queue & Records Bridge

    public func getPendingSyncRecords() -> [(recordType: String, recordId: String, operation: String)] {
        return queue.sync {
            var records = [(recordType: String, recordId: String, operation: String)]()
            let sql = "SELECT record_type, record_id, operation FROM sync_queue ORDER BY created_at ASC LIMIT 100;"
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                while sqlite3_step(stmt) == SQLITE_ROW {
                    let rType = String(cString: sqlite3_column_text(stmt, 0))
                    let rId = String(cString: sqlite3_column_text(stmt, 1))
                    let op = String(cString: sqlite3_column_text(stmt, 2))
                    records.append((rType, rId, op))
                }
            }
            sqlite3_finalize(stmt)
            return records
        }
    }

    public func clearSyncQueue(records: [(recordType: String, recordId: String)]) {
        queue.sync {
            for r in records {
                exec("DELETE FROM sync_queue WHERE record_type = '\(r.recordType)' AND record_id = '\(r.recordId)';")
            }
        }
    }

    public func getSyncState(key: String) -> String? {
        return queue.sync {
            var stmt: OpaquePointer?
            let sql = "SELECT value FROM sync_state WHERE key = ?;"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_text(stmt, 1, (key as NSString).utf8String, -1, nil)
            if sqlite3_step(stmt) == SQLITE_ROW {
                return String(cString: sqlite3_column_text(stmt, 0))
            }
            return nil
        }
    }

    public func setSyncState(key: String, value: String) {
        queue.sync {
            var stmt: OpaquePointer?
            let sql = "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;"
            if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
                sqlite3_bind_text(stmt, 1, (key as NSString).utf8String, -1, nil)
                sqlite3_bind_text(stmt, 2, (value as NSString).utf8String, -1, nil)
                sqlite3_step(stmt)
            }
            sqlite3_finalize(stmt)
        }
    }

    public func countPendingSync() -> Int {
        return queue.sync {
            return scalarInt("SELECT count(*) FROM sync_queue;")
        }
    }
}
