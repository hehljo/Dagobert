import Foundation

// Stages user-opened documents independently of the WebView lifecycle and app lock.
// A document is never imported merely because another app opened it.
final class DocumentInbox: @unchecked Sendable {
    struct Entry: Codable {
        let id: String
        let name: String
        let kind: String
        var consumedAt: String?
        var dictionary: [String: Any] { ["id": id, "name": name, "kind": kind] }
    }
    private let directory: URL
    private static let storeLock = NSRecursiveLock()
    private var lock: NSRecursiveLock { Self.storeLock }
    private let maximumBytes: Int
    static let changed = Notification.Name("DagobertDocumentInboxChanged")

    static func sharedStore() throws -> DocumentInbox {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return try DocumentInbox(directory: support.appendingPathComponent("Dagobert/DocumentInbox", isDirectory: true))
    }
    init(directory: URL, maximumBytes: Int = 50 * 1024 * 1024) throws {
        self.directory = directory; self.maximumBytes = maximumBytes
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: directory.path)
        #endif
    }
    private func entries() throws -> [Entry] {
        let index = directory.appendingPathComponent("index.json")
        guard FileManager.default.fileExists(atPath: index.path) else { return [] }
        let result = try JSONDecoder().decode([Entry].self, from: Data(contentsOf: index))
        guard result.allSatisfy({ UUID(uuidString: $0.id) != nil && ["json", "csv"].contains($0.kind) }), Set(result.map(\.id)).count == result.count else {
            throw DagobertDatabase.StoreError(message: "Der Dateieingang konnte nicht sicher gelesen werden.")
        }
        return result
    }
    private func write(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    private func bytes(_ url: URL) throws -> Data {
        let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard properties.isRegularFile == true, (properties.fileSize ?? 0) <= maximumBytes else {
            throw DagobertDatabase.StoreError(message: "Bitte eine CSV- oder JSON-Datei mit höchstens 50 MB öffnen.")
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var result = Data()
        while let chunk = try handle.read(upToCount: min(1024 * 1024, maximumBytes + 1 - result.count)), !chunk.isEmpty {
            result.append(chunk)
            guard result.count <= maximumBytes else { throw DagobertDatabase.StoreError(message: "Die Importdatei ist zu groß.") }
        }
        return result
    }
    @discardableResult func stage(_ url: URL) throws -> Entry {
        lock.lock(); defer { lock.unlock() }
        let kind = url.pathExtension.lowercased()
        guard url.isFileURL, ["json", "csv"].contains(kind) else { throw DagobertDatabase.StoreError(message: "Bitte eine CSV- oder JSON-Datei öffnen.") }
        var list = try entries()
        guard list.filter({ $0.consumedAt == nil }).count < 20 else { throw DagobertDatabase.StoreError(message: "Bitte zuerst die bereits geöffneten Dateien prüfen.") }
        let data: Data
        #if os(iOS)
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?, readError: Error?, coordinated: Data?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readable in
            do { coordinated = try bytes(readable) } catch { readError = error }
        }
        if let coordinationError { throw coordinationError }
        if let readError { throw readError }
        guard let coordinated else { throw DagobertDatabase.StoreError(message: "Die Datei konnte nicht gelesen werden.") }
        data = coordinated
        #else
        data = try bytes(url)
        #endif
        let entry = Entry(id: UUID().uuidString.lowercased(), name: url.lastPathComponent, kind: kind)
        try write(data, to: directory.appendingPathComponent(entry.id + "." + kind))
        list.append(entry)
        try write(JSONEncoder().encode(list), to: directory.appendingPathComponent("index.json"))
        NotificationCenter.default.post(name: Self.changed, object: nil)
        return entry
    }
    func pending() throws -> [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return try entries().filter { $0.consumedAt == nil }.map(\.dictionary)
    }
    func read(_ id: String) throws -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        guard let entry = try entries().first(where: { $0.id == id && $0.consumedAt == nil }) else { throw DagobertDatabase.StoreError(message: "Importdatei nicht gefunden.") }
        var result = entry.dictionary
        result["base64"] = try bytes(directory.appendingPathComponent(entry.id + "." + entry.kind)).base64EncodedString()
        return result
    }
    func acknowledge(_ id: String) throws {
        lock.lock(); defer { lock.unlock() }
        var list = try entries()
        guard let index = list.firstIndex(where: { $0.id == id }) else { throw DagobertDatabase.StoreError(message: "Importdatei nicht gefunden.") }
        list[index].consumedAt = ISO8601DateFormatter().string(from: Date())
        // Preserve the protected staged source; acknowledgment only hides the pending item.
        try write(JSONEncoder().encode(list), to: directory.appendingPathComponent("index.json"))
    }
}
