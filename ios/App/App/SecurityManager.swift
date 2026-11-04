import Foundation
import LocalAuthentication

final class SecurityManager: @unchecked Sendable {
    static let shared = SecurityManager()
    private let lock = NSLock()
    private var unlocked = false
    private var generation = 0
    private var authenticationCount = 0
    var appUnlocked: Bool {
        lock.lock(); defer { lock.unlock() }; return unlocked
    }
    var authenticationInProgress: Bool {
        lock.lock(); defer { lock.unlock() }; return authenticationCount > 0
    }
    private init() {}
    enum SecurityError: LocalizedError {
        case locked, unavailable, mandatory, profilePinUnavailable
        var errorDescription: String? {
            switch self {
            case .locked: return "Bitte Dagobert mit Face ID, Touch ID oder dem Gerätecode entsperren."
            case .unavailable: return "Richte in den Geräte-Einstellungen einen Gerätecode ein, damit Dagobert deine Finanzdaten schützen kann."
            case .mandatory: return "Die Gerätesperre schützt die gesamte App und kann nicht deaktiviert werden."
            case .profilePinUnavailable: return "Auf diesem Gerät schützt die App-Sperre alle Profile. Eine zusätzliche Profil-PIN ist nicht vorgesehen."
            }
        }
    }
    func appLockEnabled() throws -> Bool { true }
    func requireAppAccess() throws {
        guard appUnlocked else { throw SecurityError.locked }
    }
    func lockApp() {
        lock.lock(); defer { lock.unlock() }
        unlocked = false
        generation += 1
    }
    func setAppLock(_ enabled: Bool) async throws {
        guard enabled else { throw SecurityError.mandatory }
        try requireAppAccess()
    }
    func canAuthenticate() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }
    private func beginAuthentication() -> Int {
        lock.lock(); defer { lock.unlock() }; authenticationCount += 1; return generation
    }
    private func endAuthentication(_ token: Int, success: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }; authenticationCount -= 1
        if success && token == generation { unlocked = true; return true }
        return false
    }
    func authenticate(reason: String) async throws -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Abbrechen"
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { throw SecurityError.unavailable }
        let token = beginAuthentication()
        do {
            let success = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return endAuthentication(token, success: success)
        } catch { _ = endAuthentication(token, success: false); throw error }
    }
    func requireProfile(_ id: String, database: DagobertDatabase) throws {
        try requireAppAccess()
        try database.requireProfile(id)
        // Legacy PIN hashes remain stored for compatibility; the app lock grants profile access.
    }
    func unlockProfile(_ id: String, pin: String, database: DagobertDatabase) throws -> Bool {
        try requireProfile(id, database: database)
        return true
    }
}
