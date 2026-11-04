import Foundation
import Security

enum BankAccessStore {
    private static func query(_ profile: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "de.lupfa.dagobert.comdirect.access", kSecAttrAccount as String: profile]
    }
    static func load(_ profile: String) throws -> [String: String]? {
        var options = query(profile); options[kSecReturnData as String] = true; options[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(options as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let value = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
            throw ComdirectSession.BankError(message: "Der gespeicherte Bankzugang konnte nicht gelesen werden.")
        }
        return value
    }
    static func save(_ profile: String, _ credentials: [String: Any], includePin: Bool) throws {
        var value = [String: String]()
        for key in ["clientId", "clientSecret", "username"] + (includePin ? ["password"] : []) {
            guard let text = credentials[key] as? String, !text.isEmpty, text.count <= 256 else { throw ComdirectSession.BankError(message: "Ungültige Bankzugangsdaten.") }
            value[key] = text
        }
        let attributes: [String: Any] = [kSecValueData as String: try JSONSerialization.data(withJSONObject: value),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly]
        var status = SecItemUpdate(query(profile) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var options = query(profile); for (key, value) in attributes { options[key] = value }
            status = SecItemAdd(options as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ComdirectSession.BankError(message: "Der Bankzugang konnte nicht im Schlüsselbund gespeichert werden.") }
    }
    static func remove(_ profile: String) throws {
        let status = SecItemDelete(query(profile) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw ComdirectSession.BankError(message: "Der gespeicherte Bankzugang konnte nicht entfernt werden.") }
    }
}
