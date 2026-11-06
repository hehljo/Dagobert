# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`CLAUDE.md` ist ein Symlink auf `AGENTS.md` — nur `AGENTS.md` bearbeiten.
Aktueller Arbeitsstand, Freigaben und Nachweise: `HANDOVER.md` (Kopf ist verbindlich).
Mobile Architektur im Detail: `MOBILE_ARCHITECTURE.md`.

## Was Dagobert ist

Private Haushaltsbuch-App für comdirect-Konten (CSV-Import und Direktabruf), React 19 + Vite +
Tailwind. Zwei Auslieferungen aus derselben Oberfläche:

- **Web/Docker:** React-Build + Express-Server (`server/index.js`, Port 5052) mit SQLite
  (`better-sqlite3`, `server/db.js`), Profil-PIN und verschlüsselt gespeichertem Bankzugang.
- **iOS:** Capacitor 8 bündelt den Vite-Build, kein Express. Swift-Plugin `DagobertPlugin`
  mit eigener SQLite (`DagobertDatabase.swift`, einzige autoritative Quelle), CloudKit-Sync,
  Geräte-Sperre über Face ID, Keychain für den Bankzugang. Android ist kein Ziel.

Bundle-ID `de.lupfa.dagobert`. CloudKit-Container, App Group und Keychain sind Datenverträge:
nie still umbenennen oder migrieren.

## Befehle

| Zweck | Befehl |
|---|---|
| Dev-Server (Vite) | `npm run dev` |
| Build inkl. Typcheck | `npm run build` (`tsc -b && vite build`) |
| Unit-/Node-Tests | `npm test` (Vitest `src/tests`, `node --test tests/*.test.mjs`, SPM-Fork-Test) |
| Einzelner Vitest | `npx vitest run src/tests/dashboard.test.ts` bzw. `-t "Testname"` |
| Einzelner Node-Test | `node --test tests/server-pin.test.mjs` |
| Browser-Workflows (Playwright) | `npm run test:ui` |
| Alle lokalen Gates mit Nachweis | `npm run gates` |
| Gezielte Gate-Suite | `npm run gates -- --suite settings\|browser\|portable\|imports\|comdirect\|apple\|stale` |
| iOS synchronisieren | `npm run cap:sync` (danach `scripts/spm-fork.mjs` per Hook) |
| Privater iPhone-Build (Mac/RoamRun) | `python3 scripts/apple-check.py run --publish --manual-tests --wait` |
| App-Store-Build hochladen (Mac, braucht ASC-App-Eintrag) | `python3 scripts/apple-check.py run --app-store --prepared --wait` |
| Store-Rohscreenshots mit Demo-Daten (iPhone 6,9″, iPad 13″) | `python3 scripts/apple-check.py run --store-screenshots --prepared --wait` |

`npm run gates` schreibt Nachweise nach `.ruttla-evidence/`. Danach
`ruttla --changed-only --format agent` — nie parallel zu einem laufenden Gate.
Vor einem neuen Prüfblock klären, wer testet; die App-Bedienung am iPhone testet der Nutzer.

## Architektur

- **Repository-Grenze:** Die Oberfläche spricht nur `IDagobertRepository`
  (`src/data/interfaces.ts`). `src/data/repository.ts` wählt `webAdapter.ts` (HTTP zu Express)
  oder `nativeAdapter.ts` (Capacitor-Plugin). Neue Datenfunktionen brauchen beide Adapter,
  den Express-Endpunkt und die Swift-Seite (`DagobertPlugin.swift` + `.m`-Registrierung).
- **Plattform:** `src/platform/capabilities.ts` (`detectPlatform`) und `appAccess.ts`.
  Dexie/IndexedDB ist Altbestand und wird nicht mehr initialisiert.
- **Portables Format:** `src/data/backupSchema.ts` (Backupformat 2), `identity.ts`
  (deterministische UUIDv8, `syncId` als Buchungsidentität), `rulesPackage.ts` für
  Regeln/Kategorien. Backup-Felder sind ein Vertrag zwischen Docker und iOS
  (`tests/bidirectional-roundtrip.test.mjs`, `tests/portable/`).
- **Kontostand ist die Wahrheit für den Geldbestand:** `src/lib/db.ts`
  (`calculateRealAccountBalance`, `calculateAccountBalanceAt`) rechnet vom comdirect-
  Kontrollpunkt oder Startsaldo, nur gebuchte Umsätze des Kontos. Monatswerte
  (Einnahmen/Ausgaben, Monatsergebnis) sind Auswertung, nie zusätzlicher Bestand.
- **Monatsansicht:** `src/lib/salaryBudget.ts` ordnet Gehalt ab Stichtag nur für die Anzeige dem
  Folgemonat zu; Buchungsdatum, Kontostand, Liste und Statistik bleiben nach Buchungsdatum.
  Lokale Ansichtseinstellungen (`salaryBudget`, `dashboardPreferences`) liegen pro
  Plattform/Profil in localStorage über `useLocalPreference.ts` und gehen nicht in Backup/CloudKit.
- **Import:** `src/lib/csvParser.ts` (comdirect-CSV, Windows-1252), `bankImport.ts` und
  `src/data/comdirect.ts` / `server/comdirect.js` bzw. `ComdirectSession.swift` für den
  Direktabruf; `rulesEngine.ts` + `standardRules.json` kategorisieren. Ist ein comdirect-Zugang
  gespeichert (`useSavedBankAccess.ts`), heißt der Kopfzeilenknopf „Sync“ und öffnet direkt den Abruf.

## Grenzen

- Nur synthetische Testdaten. Keine produktive DB öffnen, migrieren oder kopieren; keine echten
  Bankzugänge lesen oder Bankanmeldung auslösen.
- Mac-Quellen, Builds und Logs liegen auf `/Volumes/Dev`; Apple-Läufe über die `scripts/apple-*.py`.
- Kein TestFlight-/App-Store- oder Server-Release ohne ausdrücklichen Auftrag.
