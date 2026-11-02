# Dagobert – Mobile Architektur & iOS Leitfaden

Dieses Dokument beschreibt die native iOS-Architektur von **Dagobert**, basierend auf Capacitor 8, Swift, lokalem SQLite und Apple CloudKit.

---

## 1. Architekturübersicht

Dagobert wird als einheitliche Codebasis betrieben, die sowohl als selbst gehostete Docker-/Web-Anwendung als auch als vollkommen autonome, offlinefähige iOS-/iPadOS-App funktioniert.

```
                      ┌────────────────────────────────────────┐
                      │          React 19 / Vite UI            │
                      │  (Dashboard, Buchungen, Regeln, etc.)  │
                      └──────────────────┬─────────────────────┘
                                         │
                             ┌───────────┴───────────┐
                             │  IDagobertRepository  │
                             └─────┬───────────┬─────┘
                                   │           │
         Plattform: Web / Docker   │           │   Plattform: iOS / iPadOS
                                   ▼           ▼
                         ┌─────────────────┐ ┌─────────────────────────┐
                         │ WebAdapter (TS) │ │    NativeAdapter (TS)   │
                         └────────┬────────┘ └────────────┬────────────┘
                                  │                       │ Capacitor Bridge
                                  ▼                       ▼
                         ┌─────────────────┐ ┌─────────────────────────┐
                         │ Express Central │ │  DagobertPlugin (Swift) │
                         │ SQLite Backend  │ └────────────┬────────────┘
                         └─────────────────┘              │
                                                          ▼
                                             ┌─────────────────────────┐
                                             │ DagobertDatabase.swift  │
                                             │   (Lokales SQLite3)     │
                                             └────────────┬────────────┘
                                                          │
                                                          ▼
                                             ┌─────────────────────────┐
                                             │  CloudKitSyncManager    │
                                             │  (Private Database)     │
                                             └─────────────────────────┘
```

---

## 2. Architekturentscheidung zur Datenhaltung

Es wurde **Architektur A** umgesetzt:
- **Autoritative Datenquelle auf iOS:** Eine native Swift-SQLite3-Datenbank (`DagobertDatabase.swift`) unter `Application Support/Dagobert/dagobert_local.sqlite`.
- **Keine konkurrierenden Speicherstände:** IndexedDB/Dexie wird auf iOS nicht als Datenquelle verwendet. Alle Schreib- und Lesevorgänge laufen transaktional über SQLite.
- **Verschlüsselung & Schutz:** Die SQLite-Datei und ihr Verzeichnis sind über iOS Data Protection (`NSFileProtectionComplete` / `.protectionKey: FileProtectionType.complete`) gesichert und bei gesperrtem Gerät hardwareverschlüsselt.
- **Cent-Präzision:** Geldbeträge werden intern in Cent als 64-Bit Integer gespeichert (`amount_cents`), um Fließkomma-Ungenauigkeiten und Rundungsdrift zwischen Geräten auszuschließen.
- **Tombstones:** Gelöschte Datensätze erhalten ein `deleted_at`-Timestamp, damit Löschungen über CloudKit zuverlässig an andere Geräte übertragen werden, ohne dass alte Datensätze wiederauferstehen.

---

## 3. iCloud-Synchronisierung (CloudKit)

- **Datenbanktyp:** Private CloudKit Database (`container.privateCloudDatabase`). Daten sind privat und isoliert für die jeweilige Apple ID des Nutzers (kein automatisches Teilen im Apple-Familienkreis).
- **Custom Record Zone:** `DagobertZone`. Ermöglicht atomare Zonenänderungen und Delta-Sync via `CKFetchRecordZoneChangesOperation` und `CKSyncEngine`.
- **Verschlüsselte Daten:** Vertrauliche Finanzdaten (Beträge, Verwendungszwecke, Empfänger, Kontosalden, PIN-Hashes) werden über `CKRecord.encryptedValues` verschlüsselt gespeichert.
- **Hintergrund-Events:** `AppDelegate.swift` fängt Silent Push Notifications (`didReceiveRemoteNotification`) ab und stößt Hintergrund-Synchronisierungen an.
- **Konfliktbehandlung:** Deterministische *Last-Write-Wins*-Auflösung anhand des UTC-Zeitstempels `updated_at`. Lokale manuelle Änderungen überschreiben keine noch ungebuchten CSV-Imports.

---

## 4. Lokale Gerätesicherheit & Biometrie

- **Apple LocalAuthentication:** Face ID / Touch ID und Gerätecode-Fallback (`SecurityManager.swift`).
- **Keychain Services:** Kryptographische Schlüssel und Tokens werden ausschließlich in der iOS-Keychain mit `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` abgelegt.
- **App-Switcher-Sichtschutz:** Beim Wechsel in den Multitasking-Switcher (`applicationWillResignActive`) blendet die App ein `UIBlurEffect`-Overlay über das Anwendungsfenster ein, um Kontostände vor Blicken Dritter zu schützen.
- **Datenschutz-Manifest:** `PrivacyInfo.xcprivacy` deklariert die Nutzung von `NSPrivacyAccessedAPICategoryUserDefaults` mit dem passenden Apple-Grund `CA92.1` (ITMS-91053 konform).

---

## 5. Bidirektionaler JSON-Datenaustausch

Das unifizierte Backup-Schema (`src/data/backupSchema.ts`) garantiert verlustfreien Datenaustausch:
- **Format-Identifikator:** `"format": "dagobert_backup"`, Schema-Version `1`.
- **Richtung:** Docker ↔ iOS ↔ Docker.
- **Vollständigkeit:** Profile, Konten, Checkpoint-Salden, Umsätze, Kategorien, Budget, Regeln und Bankimport-Vorlagen (`bankTemplates`).
- **Sicherheits-Filter:** Keychain-Schlüssel und gerätegebundene Biometrie werden niemals exportiert.
- **Import-Modi:**
  - *Ersetzen:* Ersetzt die Daten des Zielprofils atomar.
  - *Zusammenführen (Merge):* Gleicht Bestände anhand deterministischer Hashes (`sourceHash`) ab und importiert nur neue Datensätze ohne Duplikate.

---

## 6. Anleitung: Bauen und Ausführen mit Xcode

### Voraussetzungen auf dem Mac
- macOS Sonoma oder neuer
- Xcode 15 oder neuer
- Node.js 20+ und npm
- Eine Apple ID (für lokales Debug-Signing genügt ein kostenloser Apple Account)

### Schritt-für-Schritt

1. **Repository klonen und vorbereiten:**
   ```bash
   git clone https://github.com/hehljo/Dagobert.git
   cd Dagobert
   npm install
   npm run build
   npx cap sync ios
   ```

2. **Xcode-Projekt öffnen:**
   ```bash
   npx cap open ios
   # oder manuell:
   open ios/App/App.xcworkspace
   ```

3. **Signing & Capabilities einrichten:**
   - Klicke im linken Projekt-Navigator auf das blaue Projekt-Icon `App`.
   - Wähle unter **Targets** das Target `App`.
   - Wechsle auf den Reiter **Signing & Capabilities**.
   - Setze bei **Team** dein persönliches oder Entwickler-Team.
   - Stelle sicher, dass die Entitlements für **iCloud (CloudKit)** aktiv sind und die Container-ID `iCloud.de.dagobert.app` zugewiesen ist.

4. **Auf realem iPhone starten:**
   - Verbinde dein iPhone per USB-Kabel oder WLAN mit dem Mac.
   - Wähle dein iPhone in der oberen Geräteleiste von Xcode aus.
   - Drücke `Cmd + R` (Run).
   - Beim ersten Start auf dem iPhone: Unter *Einstellungen → Allgemein → VPN & Geräteverwaltung* das Entwicklerzertifikat bestätigen.

---

## 7. Bekannte Einschränkungen & Abgrenzung

- **Kein Android-Scope:** Die native SQLite- und CloudKit-Implementierung ist für iOS/iPadOS konzipiert. Eine spätere Android-Version benötigt eine separate Synchronisierungs- und Keystore-Bridge.
- **CloudKit Kontogrenzen:** CloudKit Private Database synchronisiert ausschließlich zwischen Geräten, die mit derselben Apple-ID angemeldet sind. Ein Teilen zwischen separaten Apple-IDs ist nicht Gegenstand der privaten Datenbank.
