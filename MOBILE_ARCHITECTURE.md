# Dagobert: Capacitor, lokale Daten und iCloud

Stand 04.11.2026: Aktueller privater RoamRun-Build 1.0 (4) veröffentlicht;
Archiv/Ad-Hoc-Export, Signatur und vollständiger HTTPS-Download sind belegt.
Aktuelle lokale Quellen-Nachweise und Grenzen stehen in HANDOVER.md.
Native Bedienung, Hardware-Face-ID/Keychain, echter Bankabruf und CloudKit-
Transport zwischen Geräten bleiben zur Abnahme beim Nutzer. Kein App-Store-/
TestFlight-Release und keine Web-/Server-Veröffentlichung.

## Kalender- und Budgetmonat

`src/lib/salaryBudget.ts` ordnet ausschließlich für die Ansicht positive gebuchte
EUR-Einnahmen der Kategorie `gehalt` ab einem wählbaren Tag dem Folgemonat zu.
Der Stichtag gilt einschließlich, höchstens bis zum letzten Tag des jeweiligen
Monats; der Jahreswechsel ist berücksichtigt. Bankdatum und Datensatz bleiben
unverändert. Das Dashboard bietet bei aktivierter Option Kalender-/Budgetmonat;
Kontostand, Buchungsliste und Statistik verwenden weiter die Buchungsdaten.

Die Option ist standardmäßig aus, Tag 25 voreingestellt. `useSalaryBudget.ts`
speichert nur die Ansichtspräferenz lokal pro Plattform/Profil. Die Präferenz
gehört weder in finanzielle Backups noch in CloudKit; hierfür wurde kein
Datenbankschema geändert. Fehler beim Speichern werden angezeigt; defekte
Präferenzen verwenden den Kalenderstandard.

## Datenfluss

Die React-Oberfläche verwendet `IDagobertRepository`. Im Browser spricht der
Web-Adapter mit Express; auf iOS spricht der native Adapter über `DagobertPlugin`
mit Swift. Die App bündelt den Vite-Build und benötigt keinen Express-Server.
Android ist kein implementiertes Ziel.

Auf iOS ist ausschließlich `Application Support/Dagobert/dagobert_local.sqlite`
autoritativ. `DagobertDatabase.swift` speichert Datensätze, Tombstones, Revisionen,
CloudKit-Systemfelder und die dauerhafte Änderungswarteschlange in SQLite.
Finanzinhalte und unbekannte fachliche JSON-Felder bleiben in den Datensatz-Payloads
erhalten; Buchungsbeträge werden zusätzlich als ganze Centbeträge geführt.
Ein rekursiver Lock serialisiert Datenbankoperationen, Schreibvorgänge verwenden
Transaktionen und SQL-Fehler werden weitergereicht. Eine Änderung und ihre
Sync-Vormerkung werden gemeinsam gespeichert.

Die bisherigen nativen Tabellen werden bei der ersten Öffnung transaktional
übernommen und bleiben anschließend unverändert erhalten. Die synthetische
Migration prüft Centbeträge, Nullwerte, PIN-Übernahme, Tombstones und unveränderte
Quelltabellen; ein SQLite-Abbruch prüft den vollständigen Rollback. Migrationen
auf echten Nutzerdaten benötigen weiterhin eine separate Freigabe und Apple-Abnahme.

Dexie wird von der produktiven Oberfläche nicht mehr initialisiert. Alte
IndexedDB-Inhalte werden weder gelöscht noch als zweite Datenquelle verwendet.
Die Docker-Version behält ihre bestehenden SQLite-Tabellen und lokalen Integer-IDs;
`portable_fields` ergänzt stabile Austausch-Identitäten und zusätzliche Fachfelder.
Native UI-IDs dürfen von Docker-IDs abweichen. `syncId` erhält die Buchungsidentität.
Deterministische UUIDv8-Namen sind Identitäten, keine Sicherheits-Hashes.

## Backupformat 2

`src/data/backupSchema.ts` ist der gemeinsame, auch vom Server verwendete Vertrag.
Der Identifier lautet `dagobert_backup`, `schemaVersion` ist 2.
Die Wurzel enthält das gewählte Profil einschließlich `profile` und der fünf
Sammlungen `accounts`, `categories`, `rules`, `transactions`, `bankTemplates`.
`additionalProfiles` enthält weitere vollständige Profilbestände; `profiles`
enthält nur deren Metadaten und ersetzt niemals diese Bestände.

Alte Einzelprofil-Backups werden normalisiert. `includedCollections` erhält bei
historischen Teilbackups die Unterscheidung zwischen fehlenden und ausdrücklich
leeren Datenbereichen. Ältere vermeintliche Gesamtbackups mit Profilnamen ohne
zugehörige Daten werden mit einer Erklärung zurückgewiesen.

Unbekannte fachliche Felder bleiben erhalten. Unbekannte Schemaversionen, defekte
Regelkonfigurationen, Kalenderdaten und nicht als ganze Centbeträge darstellbare
Summen werden abgelehnt. PIN-Hashes, Keychain-Daten, Biometrie und Sitzungen gehören
nicht in den Austausch. Importierte neue Profile benötigen eine neue PIN-Einrichtung.
Ein vorhandener lokaler Profil-PIN wird beim Ersetzen nicht überschrieben.

Importmodi:

- **Zusammenführen:** Alle Entitätstypen berücksichtigen; gleiche Identitäten mit
  abweichenden Werten brechen den gesamten Import ab. Kein blindes Last-Write-Wins.
- **Ersetzen:** Enthaltene Datenbereiche nach ausdrücklicher Bestätigung ersetzen;
  vorher eine Wiederherstellungssicherung speichern. Ausdrücklich leere Listen
  leeren den entsprechenden Bereich.
- **Neue Profile:** Getrennte Profile anlegen und vorhandene Profile erhalten.

Ein vollständiger Export setzt Zugriff auf alle enthaltenen geschützten Profile
voraus. Web-Sitzungen können mehrere zuvor einzeln entsperrte Profile umfassen;
eine geänderte PIN entzieht weiterhin den Zugriff auf das betroffene Profil.
Wiederherstellungssicherungen können in den Einstellungen exportiert und erneut
über den normalen Vorschaudialog importiert werden. Sie sind kein unabhängiges Backup.

CSV-Fingerprints bleiben Importmerkmale und sind kein globaler UNIQUE-Schlüssel.
Mehrere tatsächlich identische CSV-Zeilen erhalten unterscheidbare Vorkommens-Hashes.
Bei historischen Buchungen ohne stabile Austausch-ID kann die ursprüngliche
plattformübergreifende Identität nicht nachträglich sicher bewiesen werden;
abweichende Bestände deshalb als neues Profil übernehmen statt still überschreiben.

## CloudKit

`CloudKitSyncManager` ist ein UI-unabhängiger Actor mit `CKSyncEngine` für die private
Datenbank des Containers `iCloud.de.dagobert.app`, Zone `DagobertZone`.
Der Record-Typ `DagobertEntity` enthält ein verschlüsseltes `payloadEncrypted`-Feld mit dem
vollständigen Datensatz einschließlich Profilzuordnung und Löschinformation. Das Feld `payload`
ist in Production am 04.11.2026 versehentlich als unverschlüsseltes Bytes deployt worden, ist
damit unveränderlich und wird nicht benutzt.
Für dieses neue Feld muss das Development-Schema eingerichtet und vor einer
Veröffentlichung nach Production übernommen werden. Das ist noch nicht geschehen.

Die Engine startet nach bewusster Aktivierung. Vor dem ersten Upload werden
vorhandene Cloud-Daten eingelesen. Unveränderte Startvorlagen gelten dabei als
ersetzbare Platzhalter; echte lokale Änderungen werden erhalten. Engine-Zustand,
Outbox und bekannte CloudKit-Systemfelder überstehen Neustarts. Eine Bestätigung
einer älteren Revision darf eine inzwischen entstandene lokale Änderung nicht
als synchronisiert markieren. Die Batchgröße ist auf 200 begrenzt.

Bei widersprüchlichen Änderungen werden beide Versionen gesichert und der
betroffene Datensatz bis zur bewussten Auswahl einer Version blockiert.
Backups erhalten zusätzlich die aktuelle Konfliktversion. Import stellt aktive
Konflikte und ihre Upload-Sperre wieder her; neue Profile erhalten getrennte
Konfliktidentitäten. Nachträglich außerhalb der Konfliktauflösung veränderte
Konfliktdatensätze werden beim Import abgelehnt, statt Änderungen zu übergehen.
Konflikte und ihre Auflösung werden selbst synchronisiert. Ein Zeitstempel allein
entscheidet keine Finanzänderung. App-Löschungen werden als Tombstones übertragen.
Unerwartet entfernte Cloud-Daten lösen keinen automatischen Neu-Upload aus.

Der Datenbestand bleibt an seinen bisherigen Apple-Account gebunden. Bei Abmeldung
bleiben lokale Daten und Änderungen erhalten; bei einem anderen Account ist ein
Upload des bisherigen Bestands blockiert. Eine automatische Account-Übernahme oder
Cloud-Datenlöschung ist nicht implementiert. Private Daten werden nicht automatisch
mit anderen Apple-Familienmitgliedern geteilt. Docker nimmt nicht am CloudKit-Sync teil.

`encryptedValues` ist keine pauschale E2EE-Zusage unabhängig von Apples
Datenschutzmodus. Der erweiterte Datenschutz und seine Einschränkungen sind gesondert
zu berücksichtigen. Metadaten und Record-IDs bleiben außerhalb des Finanz-Payloads.

## Gerätesicherheit und Dateien

Gerätesperre und Gerätecode/Face-ID/Touch-ID werden nativ über LocalAuthentication
und Keychain gesteuert, nicht durch WebAuthn oder einen localStorage-Schalter.
Profil-PINs bleiben lokal und verwenden für neue Hashes PBKDF2-SHA256 mit zufälligem
Salt; bestehende native Hashes werden nach erfolgreicher Entsperrung aktualisiert.
Die Bridge prüft Gerätesperre und Profilzugriff, auch bei direktem Methodenaufruf.

Der Szenen-Lebenszyklus verdeckt sensible Inhalte durch eine undurchsichtige Fläche
und sperrt beim Verlassen. SQLite-Datei, Verzeichnis, WAL/SHM und native Exportdateien
verwenden Data Protection `complete`. Das ist keine zusätzliche SQLCipher-Verschlüsselung.
Zugriffe bei gesperrtem Gerät dürfen deshalb scheitern; Sync muss nach Entsperren
fortgesetzt werden. Zuverlässiger Sync bei gesperrtem Gerät ist nicht nachgewiesen.

Dateiauswahl erfolgt über die iOS-Dateiauswahl der WebView. Der native Export teilt
eine geschützte JSON-Datei über UIActivityViewController; er verschickt keine
Finanzdaten als Textnachricht. Außerhalb der App ist ein exportiertes JSON nicht
passwortverschlüsselt. Eingehende „Öffnen mit“-Dateien werden für Kalt- und
Warmstart im separaten DocumentInbox gespeichert: maximal 50 MB, ausschließlich
CSV/JSON, koordinierter Dateizugriff und geschützte lokale Kopie. Die Oberfläche
zeigt das Zielprofil und öffnet dieselbe Vorschau wie die normale Dateiauswahl;
es gibt keinen automatischen Import. Bestätigung entfernt nur den Eintrag aus
der Warteliste; die geschützte Quelldatei bleibt erhalten. Speicher, Neustart,
Byte-Erhalt und Ablehnungsfälle sind lokal geprüft. iOS-Dateischutz, Security Scope
und die tatsächliche Übergabe aus der Dateien-App bleiben Apple-/Geräteprüfungen.
Capacitor-Plugin-Logging ist in der Konfiguration abgeschaltet; tatsächliche
Gerätelogs wurden hier nicht erhoben.

## Wiederholbare lokale Prüfung

`npm run gates` führt den gemeinsamen lokalen Prüfblock aus, sobald er vom Nutzer
freigegeben ist. Mit `-- --suite portable` oder `-- --suite imports` sind gezielte
Teilläufe möglich; nur der unveränderte Gesamtlauf erzeugt alle Qualitätsreceipts.
Der Ablauf sperrt parallele Läufe, schreibt Logs und Exitstatus in
`.ruttla-evidence/runs/`, erhält synthetische Testdaten und veröffentlicht nichts.
Ruttla prüft vorab den Bestand und nach den Suites geänderte Dateien und den Gesamtstand.
`npm run test:quality` erzeugt quellgebundene Receipts für die Ruttla-Regel
`quality.contract_runtime_evidence`.

`npm run test:portable` kompiliert die tatsächliche Swift-SQLite-Schicht und führt
sie auf Linux aus. Ein Server-Export wird wirklich in diesen Store importiert und
zurück nach Docker übertragen. Weitere Fälle prüfen beide Austauschrichtungen,
mehrere Profile, Wiederholungen, Konflikte, optionale/zusätzliche Felder,
synthetische SQLite-Abbrüche und erhaltene Outbox-Einträge. Die Swift-Kompilierung behandelt Warnungen als Fehler. Anschließend werden alle
geänderten Swift-Dateien geparst. Das ist kein CloudKit-Transport-, iOS-Signing-,
LocalAuthentication-, Simulator- oder Gerätenachweis.

Die vorhandenen API-/Browser-Suites bleiben Bestandteil des lokalen Blocks.
Ein vorhandener grüner Receipt oder Exit 0 ist keine aktuelle Plattformabnahme.

## Mac und verbleibende Abnahme

Die App benötigt mindestens iOS/iPadOS 17 wegen CKSyncEngine. Vor einem autorisierten
Apple-Build die aktuelle globale Anleitung für Remote-iOS beachten und den
Mac-/CI-Weg festlegen. Lokal: `npm ci`, `npm run cap:sync`, anschließend
`ios/App/App.xcodeproj` mit einer zu Capacitor 8 kompatiblen aktuellen Xcode-Version
öffnen. Team, CloudKit-Container, Push-Capability und Provisioning müssen auf dem
gewählten Apple-Account tatsächlich eingerichtet sein; ein kostenloses Personal
Team ist kein belegter CloudKit-/Push-Distributionsweg.

Debug verwendet `APS_ENVIRONMENT=development`, Release `production`.
Am 03.11.2026 ist der vollständige Simulator-Build mit Xcode 27.0 und Warnungen
als Fehler belegt, einschließlich CKSyncEngine/UIKit/Bridge/Sicherheit. 20
Produktions-Swift-Store-/Inbox-Fälle liefen zusätzlich auf macOS. Der native
iPhone-/iPad-UI-Prüfblock ist grün: jeweils Navigation und Buchungspersistenz nach
App-Neustart, 2 bestanden/0 fehlgeschlagen/0 übersprungen auf iOS 26.5.
Release-Testing-IPA 1.0 (1) signiert und privat per RoamRun verteilt; HTTPS/Manifest/
vollständiger IPA-Download gegen den Mac-Export geprüft. Details in `HANDOVER.md`.
Der wiederholbare Einstieg ist `python3 scripts/apple-check.py run --publish --wait`:
lokale Gates, gehashter externer Mac-Snapshot, Simulatoren und bedingte private OTA-
Verteilung. Eigene Testprozesse und Terminalfenster werden beendet, fremde erhalten.
Der vorhandene Mac-Checkout wird dabei weder überschrieben noch zurückgesetzt.
Bei Xcode „No Accounts“ verwendet `apple-provision.py` den vorhandenen geschützten
Mac-API-Schlüssel, bestehende App-ID/Distribution-Identität und das bereits
registrierte iPhone. Nur das Ad-Hoc-Profil wird bei Fehlen erzeugt; keine neuen
Zertifikate/Geräte/Capabilities. Manuelle Exportzuordnung benötigt keinen ASC-Upload.

Migration auf echten Apple-Beständen, Gerätesperre und Dokumentenwege auf echten
iPhone/iPad, zwei reale Apple-Geräte, Accountwechsel, Quota-/Abbruchfälle sowie
CloudKit Development/Production bleiben offen. Privater RoamRun-Testbuild nach
bestandenen Gates ist freigegeben; kein TestFlight-/App-Store-Upload.

Unter `data/` sind weiterhin Datenbank-, WAL- und SHM-Dateien versioniert. Ihr Inhalt
wurde in diesem Block nicht geöffnet und ist nicht als synthetisch bestätigt.
`.gitignore` entfernt bereits versionierte Dateien nicht. Keine Historie wurde
umgeschrieben und kein vorhandener Datenbestand wurde bereinigt.

Primärquellen:
- https://developer.apple.com/videos/play/wwdc2023/10188/
- https://github.com/apple/sample-cloudkit-sync-engine
- https://developer.apple.com/documentation/cloudkit/ckrecord/encryptedvalues
- https://developer.apple.com/documentation/cloudkit/cksyncengine-5sie5/event/accountchange
- https://capacitorjs.com/docs/plugins/ios
