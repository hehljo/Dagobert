import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Short-lived bank sessions, held only in native memory. No bank tokens cross the JS bridge.
// All session state is accessed on DagobertPlugin's serial worker queue.
final class ComdirectSession: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    struct BankError: LocalizedError { let message: String; var errorDescription: String? { message } }
    private final class Response: @unchecked Sendable {
        let lock = NSLock()
        var value: (Data?, URLResponse?, Error?)?
        func set(_ value: (Data?, URLResponse?, Error?)) { lock.lock(); defer { lock.unlock() }; self.value = value }
        func get() -> (Data?, URLResponse?, Error?)? { lock.lock(); defer { lock.unlock() }; return value }
    }
    private let requestSession = UUID().uuidString.replacingOccurrences(of: "-", with: "")
    private var counter = 0
    private var token = ""
    private var clientID = ""
    private var clientSecret = ""
    private var bankSession = ""
    private var challengeID = ""
    private var challengeType = ""
    private var accountIDs = Set<String>()
    private(set) var expiresAt = Date().addingTimeInterval(600)

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }

    private func fail(_ text: String) -> BankError { BankError(message: text) }
    private func identifier(_ value: Any?) throws -> String {
        guard let value = value as? String, value.range(of: "^[a-zA-Z0-9_-]{1,128}$", options: .regularExpression) != nil else {
            throw fail("Ungültige Bankkennung.")
        }
        return value
    }
    private func field(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String, !value.isEmpty, value.count <= 256 else { throw fail("Bankangaben fehlen oder sind ungültig.") }
        return value
    }
    private func sessionBody() -> [String: Any] { ["identifier": bankSession, "sessionTanActive": true, "activated2FA": true] }
    private func request(_ method: String, _ path: String, _ body: [String: Any]? = nil,
                         headers: [String: String] = [:]) throws -> (Any, HTTPURLResponse) {
        guard expiresAt > Date(), let url = URL(string: "https://api.comdirect.de" + path) else { throw fail("Die Bankverbindung ist abgelaufen. Bitte neu anmelden.") }
        var request = URLRequest(url: url, timeoutInterval: 25)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let form = path == "/oauth/token"
        request.setValue(form ? "application/x-www-form-urlencoded" : "application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        counter += 1
        let info: [String: Any] = ["clientRequestId": ["sessionId": requestSession, "requestId": String(format: "%09d", counter)]]
        request.setValue(String(data: try JSONSerialization.data(withJSONObject: info), encoding: .utf8), forHTTPHeaderField: "x-http-request-info")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        if let body {
            if form {
                let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
                let values = try body.sorted(by: { $0.key < $1.key }).map { key, value -> String in
                    guard let text = value as? String,
                          let encodedKey = key.addingPercentEncoding(withAllowedCharacters: allowed),
                          let encodedValue = text.addingPercentEncoding(withAllowedCharacters: allowed) else { throw fail("Ungültige Bankanfrage.") }
                    return encodedKey + "=" + encodedValue
                }
                request.httpBody = values.joined(separator: "&").data(using: .utf8)
            } else { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        }
        let config = URLSessionConfiguration.ephemeral
        config.urlCache = nil; config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let semaphore = DispatchSemaphore(value: 0), response = Response()
        let task = session.dataTask(with: request) { data, reply, error in
            response.set((data, reply, error)); semaphore.signal()
        }
        task.resume()
        guard semaphore.wait(timeout: .now() + 35) == .success,
              let (data, reply, error) = response.get(), error == nil,
              let http = reply as? HTTPURLResponse, let data, data.count <= 8 * 1024 * 1024 else {
            task.cancel(); throw fail("Die Verbindung zur Bank ist fehlgeschlagen. Es wurde nichts importiert.")
        }
        if http.statusCode == 404, method == "GET", path.hasSuffix("/transactions?transactionState=BOOKED&paging-first=0") {
            return (["values": [], "paging": ["index": 0, "matches": 0]], http)
        }
        guard (200..<300).contains(http.statusCode) else {
            throw fail("comdirect hat den Schritt abgelehnt (HTTP \(http.statusCode)). Bitte die Freigabe im Onlinebanking prüfen; TAN nicht mehrfach ausprobieren.")
        }
        return (data.isEmpty ? [:] : try JSONSerialization.jsonObject(with: data), http)
    }
    private func acceptToken(_ value: Any) throws {
        guard let body = value as? [String: Any], let access = body["access_token"] as? String, !access.isEmpty,
              let seconds = Double(String(describing: body["expires_in"] ?? "")), seconds.isFinite, seconds > 0 else { throw fail("Ungültige Anmeldeantwort der Bank.") }
        token = access; expiresAt = min(expiresAt, Date().addingTimeInterval(seconds))
    }
    func login(_ body: [String: Any]) throws -> [String: Any] {
        clientID = try field(body, "clientId"); clientSecret = try field(body, "clientSecret")
        let result = try request("POST", "/oauth/token", ["client_id": clientID, "client_secret": clientSecret,
            "grant_type": "password", "username": try field(body, "username"), "password": try field(body, "password")])
        try acceptToken(result.0)
        guard let statuses = try request("GET", "/api/session/clients/user/v1/sessions").0 as? [[String: Any]], statuses.count == 1 else { throw fail("Die Banksitzung ist nicht eindeutig.") }
        bankSession = try identifier(statuses[0]["identifier"])
        let response = try request("POST", "/api/session/clients/user/v1/sessions/\(bankSession)/validate", sessionBody()).1
        guard let header = response.value(forHTTPHeaderField: "x-once-authentication-info"), let bytes = header.data(using: .utf8),
              let challenge = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let id = challenge["id"] as? String, let type = challenge["typ"] as? String,
              ["P_TAN", "P_TAN_PUSH", "M_TAN"].contains(type) else { throw fail("Das TAN-Verfahren wird nicht unterstützt.") }
        challengeID = id; challengeType = type
        var visible: [String: Any] = ["typ": type]
        if type == "P_TAN", let image = challenge["challenge"] as? String { visible["image"] = image }
        return ["challenge": visible]
    }
    func confirm(_ body: [String: Any]) throws -> [String: Any] {
        guard !challengeID.isEmpty else { throw fail("Es liegt keine offene TAN-Freigabe vor.") }
        let info = try JSONSerialization.data(withJSONObject: ["id": challengeID])
        var headers = ["x-once-authentication-info": String(decoding: info, as: UTF8.self)]
        if challengeType != "P_TAN_PUSH" {
            let tan = try field(body, "tan")
            guard tan.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { throw fail("Bitte eine sechsstellige TAN eingeben.") }
            headers["x-once-authentication"] = tan
        }
        _ = try request("PATCH", "/api/session/clients/user/v1/sessions/\(bankSession)", sessionBody(), headers: headers)
        try acceptToken(request("POST", "/oauth/token", ["client_id": clientID, "client_secret": clientSecret, "grant_type": "cd_secondary", "token": token]).0)
        clientID = ""; clientSecret = ""; challengeID = ""
        guard let balances = try request("GET", "/api/banking/clients/user/v2/accounts/balances").0 as? [String: Any],
              let values = balances["values"] as? [[String: Any]] else { throw fail("Ungültige Kontenliste der Bank.") }
        let accounts: [[String: Any]] = try values.map { item in
            guard let account = item["account"] as? [String: Any] else { throw fail("Ungültige Kontenliste der Bank.") }
            let id = try identifier(account["accountId"]); accountIDs.insert(id)
            return ["accountId": id, "iban": account["iban"] as? String ?? "", "currency": account["currency"] as? String ?? "",
                    "label": (account["accountType"] as? [String: Any])?["text"] as? String ?? "comdirect Konto"]
        }
        return ["accounts": accounts]
    }
    func transactions(_ body: [String: Any]) throws -> [String: Any] {
        let id = try identifier(body["accountId"])
        guard accountIDs.contains(id), let first = body["first"] as? Int, first >= 0, first <= 100000 else { throw fail("Ungültiges Bankkonto oder ungültige Abrufseite.") }
        guard let page = try request("GET", "/api/banking/v1/accounts/\(id)/transactions?transactionState=BOOKED&paging-first=\(first)").0 as? [String: Any] else { throw fail("Ungültige Umsatzantwort der Bank.") }
        return page
    }
    func disconnect() { _ = try? request("DELETE", "/oauth/revoke"); token = ""; clientSecret = "" }
}
